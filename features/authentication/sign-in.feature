@authentication
Feature: Customer sign-in and sign-out
  As a registered ParaBank customer
  I want to sign in to and out of online banking
  So that only I can access my accounts

  # The complete authenticated lifecycle: sign-in proven by the bank (session identity), sign-out
  # proven by the bank (the session can no longer read the accounts).
  @smoke @sanity @regression @p0
  Scenario: A registered customer signs in with valid credentials and signs out
    Given I am a registered ParaBank customer who is signed out
    When I sign in with my credentials
    Then I should see my accounts overview
    And I should be greeted by my name
    And I am signed in as that customer
    When I sign out
    Then my banking session should be ended

  @regression @p0
  Scenario: Sign-in is refused when the password is wrong
    Given I am a registered ParaBank customer who is signed out
    When I sign in with an incorrect password
    Then I should be told that my credentials could not be verified
    And I should not have access to my accounts

  @p2
  Scenario: Sign-in requires both a username and a password
    Given I am a visitor on the ParaBank home page
    When I sign in without entering any credentials
    Then I should be asked to enter a username and password

  @regression @p1
  Scenario: Sign-in with an unknown username gets the same answer as a wrong password
    Given I am a visitor on the ParaBank home page
    When I sign in with a username that is not registered
    Then I should be told that my credentials could not be verified
    And I should not be signed in

  @p2
  Scenario: Sign-in requires a password
    Given I am a registered ParaBank customer who is signed out
    When I sign in with my username but no password
    Then I should be asked to enter a username and password
    And I should not have access to my accounts

  # Known defect (docs/defects.md): states the correct behavior and fails until it is fixed.
  # Sign-in is proven first; signing out is the action under test here.

  @known-defect @PB-14 @p1
  Scenario: After signing out, a banking page asks me to sign in
    Given I am a registered ParaBank customer who is signed out
    And I sign in with my credentials
    And I am signed in as that customer
    When I sign out
    And I open my accounts overview page directly
    Then I should be told "You must be logged in to use this feature."
    And I should not have access to my accounts
