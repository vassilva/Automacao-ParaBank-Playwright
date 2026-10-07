@authentication
Feature: Recover forgotten login information
  As a customer who forgot my login information
  I want the bank to verify my identity before helping me
  So that nobody else can recover my credentials

  @p2
  Scenario: Login recovery requires every identity detail
    Given I am a visitor on the login recovery page
    When I request my login information without providing any details
    Then I should be told that each of these details is required:
      | First name is required.             |
      | Last name is required.              |
      | Address is required.                |
      | City is required.                   |
      | State is required.                  |
      | Zip Code is required.               |
      | Social Security Number is required. |

  @regression @p1
  Scenario: A customer who proves their identity recovers their login and is signed in
    Given I am a registered ParaBank customer who is signed out
    When I request my login information with all my identity details
    Then I should be told my login information was located
    And the recovered username should be mine
    And I should be signed in to my own accounts

  @regression @p1
  Scenario: Login recovery refuses identity details that match no customer
    Given I am a visitor on the login recovery page
    When I request login information for identity details that match no customer
    Then I should be told "The customer information provided could not be found."
    And I should not be signed in

  # Known defect (docs/defects.md): states the correct behavior and fails until it is fixed.
  # When it reproduces, ParaBank shows the customer's credentials: failure screenshots mask that
  # panel, and assertions never print credentials.

  @known-defect @PB-12 @p0
  Scenario: Login recovery is refused when only the SSN matches
    Given I am a registered ParaBank customer who is signed out
    When I request my login information with my SSN but another person's name and address
    Then I should be told "The customer information provided could not be found."
    And I should not have access to my accounts
