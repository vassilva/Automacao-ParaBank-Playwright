@authorization
Feature: Customers can only reach their own banking data
  As a ParaBank customer
  I want my accounts, money and profile to be reachable only by me
  So that another customer cannot see or move my money

  # Functional access-control checks between two synthetic customers created for the scenario,
  # run on the controlled environment only. Every request is one ParaBank's own pages send, made
  # from the signed-in customer's session with the other customer's identifiers.
  #
  # Known defects (docs/defects.md): ParaBank checks only that SOME customer is signed in, never
  # that the data belongs to them. These scenarios state the correct behavior and fail until fixed.
  # The defect proof fails first, so the sign-out steps run only once the defect is fixed.

  # The requesting customer (A) signs in, and the sign-in is proven, before every scenario.
  Background:
    Given I am a registered ParaBank customer who is signed out
    And I sign in with my credentials
    And I am signed in as that customer

  @known-defect @PB-01 @p0
  Scenario Outline: I cannot read another customer's <resource>
    Given another customer has their own account
    When I request that customer's <resource>
    Then the bank should refuse the request
    When I sign out
    Then my banking session should be ended

    Examples:
      | resource             |
      | accounts             |
      | profile              |
      | account transactions |

  @known-defect @PB-02 @p0
  Scenario Outline: I cannot move money out of another customer's account with <operation>
    Given another customer has their own account
    When I try <operation> funded from that customer's account
    Then the other customer's accounts should be unchanged
    And the bank should refuse the request
    When I sign out
    Then my banking session should be ended

    Examples:
      | operation                |
      | a transfer to my account |
      | a bill payment           |
      | a new account            |

  @known-defect @PB-03 @p0
  Scenario: I cannot change another customer's profile
    Given another customer has their own account
    When I try to rename that customer through the profile update
    Then the other customer's profile should be unchanged
    And the bank should refuse the request
    When I sign out
    Then my banking session should be ended
