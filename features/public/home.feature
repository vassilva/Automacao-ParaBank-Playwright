@public
Feature: Public entry points to online banking
  As a visitor to the ParaBank website
  I want to find where to sign in, register and recover my login
  So that I can start using online banking

  @sanity @p2
  Scenario Outline: A visitor reaches <destination> from the home page
    Given I am a visitor on the ParaBank home page
    When I follow the <destination> entry point
    Then I should arrive at the <destination> page

    Examples:
      | destination    |
      | registration   |
      | login recovery |

  @p2
  Scenario: A visitor's message is accepted by customer care
    Given I am a visitor on the customer care page
    When I send customer care a message with my contact details
    Then customer care should thank me by name and promise to contact me

  @p2
  Scenario: Customer care requires every contact detail
    Given I am a visitor on the customer care page
    When I send customer care an empty message
    Then I should be told that each of these details is required:
      | Name is required.    |
      | Email is required.   |
      | Phone is required.   |
      | Message is required. |
