@profile
Feature: Update customer contact information
  As a ParaBank customer
  I want to keep my contact information current
  So that the bank can reach me

  # Every scenario acts as a signed-in customer of its own: sign-in is proven before the scenario
  # and sign-out is proven at its end.
  Background:
    Given I am a registered ParaBank customer who is signed out
    And I sign in with my credentials
    And I am signed in as that customer

  @sanity @regression @p1
  Scenario: Updated contact details are saved to my customer profile
    When I change my address and phone number
    Then I should be told my profile was updated
    And my customer profile should hold the new address and phone number
    And my name and identity details should be unchanged
    When I sign out
    Then my banking session should be ended

  @p2
  Scenario: A profile update requires a first name
    When I try to save my profile without a first name
    Then I should be told "First name is required."
    And my customer profile should be unchanged
    When I sign out
    Then my banking session should be ended

  @p2
  Scenario: A profile update lists every mandatory contact detail when cleared
    When I try to save my profile with every mandatory detail cleared
    Then I should be told that each of these details is required:
      | First name is required. |
      | Last name is required.  |
      | Address is required.    |
      | City is required.       |
      | State is required.      |
      | Zip Code is required.   |
    And my customer profile should be unchanged
    When I sign out
    Then my banking session should be ended

  @p2
  Scenario: The phone number is optional in my profile
    When I remove my phone number from my profile
    Then I should be told my profile was updated
    And my customer profile should have no phone number and be otherwise unchanged
    When I sign out
    Then my banking session should be ended

  # Known defect (docs/defects.md): states the correct behavior and fails until it is fixed. The
  # defect proof fails first, so the sign-out steps run only once the defect is fixed.

  @known-defect @PB-16 @p2
  Scenario: A first name made only of spaces is treated as missing
    When I try to save my profile with a first name made only of spaces
    Then I should be told "First name is required."
    And my customer profile should be unchanged
    When I sign out
    Then my banking session should be ended
