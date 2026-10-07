@payments
Feature: Pay bills from a customer account
  As a ParaBank customer
  I want to pay bills to external payees
  So that I can settle my obligations from online banking

  # Every scenario acts as a signed-in customer of its own: sign-in is proven before the scenario
  # and sign-out is proven at its end.
  Background:
    Given I am a registered ParaBank customer who is signed out
    And I sign in with my credentials
    And I am signed in as that customer

  @sanity @regression @p0
  Scenario: Pay a bill to a payee
    When I pay 42.10 dollars to a payee from my primary account
    Then the bill payment should be confirmed for that payee and amount
    And my primary account balance should decrease by 42.10 dollars
    And the payment should be recorded once as a debit to that payee
    When I sign out
    Then my banking session should be ended

  @regression @p1
  Scenario: A bill payment is not sent when the payee account numbers do not match
    When I try to pay a payee with a mistyped account number confirmation
    Then I should be told "The account numbers do not match."
    And no payment should have been submitted to the bank
    And no money should have moved in any of my accounts
    When I sign out
    Then my banking session should be ended

  @p2
  Scenario: A bill payment lists every mandatory payee detail when submitted empty
    When I submit a bill payment without any details
    Then I should be told that each of these details is required:
      | Payee name is required.        |
      | Address is required.           |
      | City is required.              |
      | State is required.             |
      | Zip Code is required.          |
      | Phone number is required.      |
      | Account number is required.    |
      | The amount cannot be empty.    |
    And no payment should have been submitted to the bank
    When I sign out
    Then my banking session should be ended

  @p2
  Scenario Outline: A bill payment with an invalid <field> is refused before it is sent
    When I try to pay a bill with the <field> set to "<value>"
    Then the <field> should be rejected with "<message>"
    And no payment should have been submitted to the bank
    When I sign out
    Then my banking session should be ended

    Examples:
      | field                | value | message                      |
      | amount               | ten   | Please enter a valid amount. |
      | payee account number | xyz   | Please enter a valid number. |

  @p2
  Scenario: A payee name made only of spaces is treated as missing
    When I try to pay a bill to a payee whose name is only spaces
    Then the payee name should be rejected with "Payee name is required."
    And no payment should have been submitted to the bank
    When I sign out
    Then my banking session should be ended

  # Known defects (docs/defects.md): these scenarios state the correct behavior and fail until
  # the defect is fixed. They are not part of any gating suite. The defect proof fails first, so
  # the sign-out steps run only once the defect is fixed.

  @known-defect
  Scenario Outline: A bill payment of <case> is rejected and moves no money
    When I pay "<amount>" dollars to a payee from my primary account
    Then no money should have moved in any of my accounts
    And the bill payment should not be completed
    When I sign out
    Then my banking session should be ended

    @PB-05 @p0
    Examples: A negative amount would credit the paying account
      | case              | amount |
      | a negative amount | -5.00  |

    @PB-07 @p2
    Examples: A zero amount would post an empty payment
      | case          | amount |
      | a zero amount | 0.00   |

    @PB-08 @p1
    Examples: Sub-cent precision would corrupt the account
      | case                 | amount |
      | a fraction of a cent | 0.001  |
