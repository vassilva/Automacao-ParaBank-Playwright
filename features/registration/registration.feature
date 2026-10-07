@registration
Feature: Register for online banking
  As a prospective ParaBank customer
  I want to register for online banking
  So that I can manage my accounts online

  @smoke @sanity @regression @p0
  Scenario: A new customer registers and starts with a funded account
    Given I am a visitor on the registration page
    When I register with valid personal details and unique credentials
    Then my online banking registration should be confirmed
    And I should be greeted by my name
    And my accounts overview should list exactly one account with a positive balance

  @regression @p1
  Scenario: Registration is refused when the password confirmation does not match
    Given I am a visitor on the registration page
    When I register with a password confirmation that does not match
    Then I should be told "Passwords did not match."
    And I should not be signed in

  @regression @p1
  Scenario: Registration is refused for a username that is already taken
    Given another customer has already registered a username
    And I am a visitor on the registration page
    When I register with that same username
    Then I should be told "This username already exists."
    And I should not be signed in

  @p2
  Scenario: Registration lists every mandatory detail when submitted empty
    Given I am a visitor on the registration page
    When I submit the registration form without any details
    Then I should be told that each of these details is required:
      | First name is required.             |
      | Last name is required.              |
      | Address is required.                |
      | City is required.                   |
      | State is required.                  |
      | Zip Code is required.               |
      | Social Security Number is required. |
      | Username is required.               |
      | Password is required.               |
      | Password confirmation is required.  |
    And the phone number should be optional

  @p2
  Scenario: A username of the maximum length is accepted
    Given I am a visitor on the registration page
    When I register with a username of exactly 20 characters
    Then my online banking registration should be confirmed

  # Known defects (docs/defects.md): these scenarios state the correct behavior and fail until
  # the defect is fixed. They are not part of any gating suite.

  @known-defect @PB-15 @p1
  Scenario: Registration is refused for an SSN that already belongs to a customer
    Given another customer has already registered with an SSN
    And I am a visitor on the registration page
    When I register with that same SSN
    Then my online banking registration should not be confirmed
    And I should not be signed in

  @known-defect @PB-16 @p2
  Scenario: Names made only of spaces are treated as missing
    Given I am a visitor on the registration page
    When I register with a first and last name made only of spaces
    Then I should be told that each of these details is required:
      | First name is required. |
      | Last name is required.  |
    And I should not be signed in

  @known-defect @PB-17 @p2
  Scenario: A username longer than 20 characters is refused for its length
    Given I am a visitor on the registration page
    When I register with a username of 21 characters
    Then I should not be signed in
    And I should not be told that the username already exists
