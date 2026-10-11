package io.github.vassilva.parabank;

import hudson.Extension;
import hudson.model.Computer;
import hudson.model.Executor;
import hudson.model.Item;
import hudson.model.ItemGroup;
import hudson.model.Job;
import hudson.model.Queue;
import hudson.model.Run;
import hudson.model.queue.CauseOfBlockage;
import hudson.model.queue.QueueTaskDispatcher;
import hudson.model.queue.WorkUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.logging.Level;
import java.util.logging.Logger;
import jenkins.model.Jenkins;
import jenkins.util.Timer;

/**
 * At most ONE build at a time across every branch and pull-request job of the ParaBank Multibranch
 * project, enforced in the Jenkins queue (docs/ci-cd.md, "Scheduling").
 *
 * <p>A Pipeline build is RUNNING as soon as it leaves the queue, before any Jenkinsfile step (lock,
 * node, script) executes, so a Jenkinsfile can only make a second build wait while it is already
 * running. This dispatcher is consulted before an item leaves the queue: while a build of the
 * project is active, every other build of it stays QUEUED ("blocked"), with no executor (not even
 * the flyweight one), no checkout and no step. When the active build finishes, the queue releases
 * exactly one blocked build, oldest first.
 *
 * <p>Scope: only top-level builds ({@link Job} queue items) whose parent is one of the projects
 * (system property {@value #PROJECTS_PROPERTY}, comma-separated full names; default {@value
 * #DEFAULT_PROJECTS}). Never blocked: branch indexing, the executor requests of the running build
 * (node placeholders), the resumption of builds after a restart, and every other Jenkins job. Fails
 * closed: if the check itself throws, the build stays queued and the reason is shown.
 */
@Extension
public class SerialQueueDispatcher extends QueueTaskDispatcher {
    private static final Logger LOGGER = Logger.getLogger(SerialQueueDispatcher.class.getName());

    static final String PROJECTS_PROPERTY = "parabank.serialQueue.projects";
    static final String DEFAULT_PROJECTS = "Automacao-ParaBank-Playwright";

    private final Set<String> projects;
    private final Set<Long> persisted = Collections.synchronizedSet(new HashSet<>());
    private final AtomicBoolean savePending = new AtomicBoolean(false);

    public SerialQueueDispatcher() {
        this(parseProjects(System.getProperty(PROJECTS_PROPERTY, DEFAULT_PROJECTS)));
    }

    SerialQueueDispatcher(Set<String> projects) {
        this.projects = Collections.unmodifiableSet(new LinkedHashSet<>(projects));
        LOGGER.info("ParaBank serial queue active for " + this.projects);
    }

    static Set<String> parseProjects(String value) {
        Set<String> names = new LinkedHashSet<>();
        for (String name : Arrays.asList(value.split(","))) {
            if (!name.trim().isEmpty()) {
                names.add(name.trim());
            }
        }
        return names;
    }

    public Set<String> getProjects() {
        return projects;
    }

    /** The serialized project of a queue task, or null when the dispatcher does not apply to it. */
    String projectOf(Queue.Task task) {
        if (task instanceof Job) {
            ItemGroup<?> parent = ((Job<?, ?>) task).getParent();
            if (parent instanceof Item && projects.contains(((Item) parent).getFullName())) {
                return ((Item) parent).getFullName();
            }
        }
        return null;
    }

    private boolean inProject(Queue.Task task, String project) {
        return project.equals(projectOf(task));
    }

    /**
     * What keeps the project busy, or null when it is idle. Three independent signals, so there is
     * no gap between "left the queue" and "build record exists": an item of the project already
     * released by the queue (pending or buildable); an executor (flyweight or heavyweight) working
     * for a build of the project; a build of the project that has not finished (also a build
     * resumed after a restart).
     */
    String activeHolder(String project, Queue.Item self) {
        Jenkins jenkins = Jenkins.get();
        Queue queue = jenkins.getQueue();
        List<Queue.Item> released = new ArrayList<>(queue.getPendingItems());
        released.addAll(queue.getBuildableItems());
        for (Queue.Item other : released) {
            if (other.getId() != self.getId() && inProject(other.task, project)) {
                return other.task.getFullDisplayName() + " (starting)";
            }
        }
        for (Computer computer : jenkins.getComputers()) {
            for (Executor executor : computer.getAllExecutors()) {
                WorkUnit unit = executor.getCurrentWorkUnit();
                if (unit != null && inProject(unit.work.getOwnerTask(), project)) {
                    Queue.Executable current = executor.getCurrentExecutable();
                    return current instanceof Run
                            ? ((Run<?, ?>) current).getFullDisplayName()
                            : unit.work.getOwnerTask().getFullDisplayName();
                }
            }
        }
        Item folder = jenkins.getItemByFullName(project);
        if (!(folder instanceof ItemGroup)) {
            throw new IllegalStateException("project " + project + " not found");
        }
        for (Object child : ((ItemGroup<?>) folder).getItems()) {
            if (child instanceof Job) {
                Run<?, ?> last = ((Job<?, ?>) child).getLastBuild();
                if (last != null && last.isBuilding()) {
                    return last.getFullDisplayName();
                }
            }
        }
        return null;
    }

    @Override
    public CauseOfBlockage canRun(Queue.Item item) {
        String project;
        try {
            project = projectOf(item.task);
        } catch (RuntimeException e) {
            LOGGER.log(Level.WARNING, "ParaBank serial queue: cannot classify " + item, e);
            return blocked("ParaBank serial queue: cannot classify this build (fail closed): " + e);
        }
        if (project == null) {
            return null;
        }
        try {
            String holder = activeHolder(project, item);
            if (holder == null) {
                return null;
            }
            persistQueueIfNew(item);
            return blocked("ParaBank serial queue: waiting for " + holder
                    + " to finish (one ParaBank pipeline at a time)");
        } catch (RuntimeException e) {
            LOGGER.log(Level.WARNING, "ParaBank serial queue: check failed for " + item, e);
            return blocked("ParaBank serial queue: check failed, build held in the queue (fail closed): " + e);
        }
    }

    /**
     * Jenkins writes the queue (queue.xml) only on a clean shutdown: after a crash, builds held here
     * would be lost (a RUNNING Pipeline resumes, a queued one does not). So the queue is saved, off
     * the queue lock, as soon as a build starts being held.
     */
    private void persistQueueIfNew(Queue.Item item) {
        if (persisted.contains(item.getId()) || !savePending.compareAndSet(false, true)) {
            return;
        }
        Timer.get().submit(() -> {
            try {
                Queue queue = Jenkins.get().getQueue();
                List<Long> ids = new ArrayList<>();
                for (Queue.Item queued : queue.getItems()) {
                    ids.add(queued.getId());
                }
                queue.save();
                persisted.retainAll(ids);
                persisted.addAll(ids);
            } catch (RuntimeException e) {
                LOGGER.log(Level.WARNING, "ParaBank serial queue: could not save the queue", e);
            } finally {
                savePending.set(false);
            }
        });
    }

    private static CauseOfBlockage blocked(String message) {
        return new CauseOfBlockage() {
            @Override
            public String getShortDescription() {
                return message;
            }
        };
    }
}
