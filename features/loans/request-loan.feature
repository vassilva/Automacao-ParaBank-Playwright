@loan
Feature: Request a loan
  As a ParaBank customer
  I want to apply for a loan online
  So that I can borrow money when my funds allow it

  # Every scenario acts as a signed-in customer of its own: sign-in is proven before the scenario
  # and sign-out is proven at its end.
  Background:
    Given I am a registered ParaBank customer who is signed out
    And I sign in with my credentials
    And I am signed in as that customer

  @sanity @regression @p1
  Scenario: A loan the customer can afford is approved and paid into a new loan account
    When I request a loan of 240 dollars with a 24 dollar down payment from my primary account
    Then the loan should be approved
    And a new loan account should be opened holding 240 dollars
    And my primary account balance should decrease by 24 dollars
    And the down payment should be recorded once against my primary account
    When I sign out
    Then my banking session should be ended

  # The rule "the down payment cannot exceed the available funds" is covered at its boundary below
  # (equal: accepted; one cent above: refused).
  Scenario Outline: A loan is denied when <condition>
    When I request a loan of <amount> dollars with a <down payment> dollar down payment from my primary account
    Then the loan should be denied with the reason "<reason>"
    And no money should have moved in any of my accounts
    When I sign out
    Then my banking session should be ended

    @regression @p1
    Examples: The amount exceeds what the customer's funds support
      | condition                          | amount | down payment | reason                                                     |
      | the customer's funds are too low   | 100000 | 12           | We cannot grant a loan in that amount with your available funds. |

  # Boundaries. ParaBank's loan provider approves a loan when the customer's available funds (all
  # non-loan balances) are at least 20% of the amount, and refuses a down payment above those
  # funds. Amounts are computed from the customer's balances read before the request.

  @regression @p1
  Scenario: A loan of exactly five times the available funds is approved
    When I request a loan of five times my available funds with a 1 dollar down payment from my primary account
    Then the loan should be approved
    And a new loan account should be opened holding the requested amount
    And my primary account balance should decrease by 1 dollars
    And the down payment should be recorded once against my primary account
    When I sign out
    Then my banking session should be ended

  @regression @p2
  Scenario: A down payment equal to the available funds is accepted
    When I request a loan of 160 dollars with a down payment equal to my available funds from my primary account
    Then the loan should be approved
    And a new loan account should be opened holding the requested amount
    And the down payment should be recorded once against my primary account
    When I sign out
    Then my banking session should be ended

  @regression @p2
  Scenario: A down payment one cent above the available funds is refused
    When I request a loan of 160 dollars with a down payment one cent above my available funds from my primary account
    Then the loan should be denied with the reason "You do not have sufficient funds for the given down payment."
    And no money should have moved in any of my accounts
    When I sign out
    Then my banking session should be ended

  # Known defects (docs/defects.md): these scenarios state the correct behavior and fail until
  # the defect is fixed. They are not part of any gating suite. The defect proof fails first, so
  # the sign-out steps run only once the defect is fixed.

  @known-defect @PB-11 @p2
  Scenario: A loan one cent above five times the available funds is denied
    When I request a loan of one cent more than five times my available funds with a 1 dollar down payment from my primary account
    Then the loan should be denied with the reason "We cannot grant a loan in that amount with your available funds."
    And no money should have moved in any of my accounts
    When I sign out
    Then my banking session should be ended

  @known-defect @PB-06 @p0
  Scenario: A negative down payment is refused and moves no money
    When I request a loan of "100.00" dollars with a "-10.00" dollar down payment from my primary account
    Then no money should have moved in any of my accounts
    And the loan should not be approved
    When I sign out
    Then my banking session should be ended

  @known-defect @PB-10 @p2
  Scenario Outline: The customer is told which loan detail is missing
    When I request a loan of "<amount>" dollars with a "<down payment>" dollar down payment from my primary account
    Then I should be told "<message>"
    And no money should have moved in any of my accounts
    When I sign out
    Then my banking session should be ended

    Examples:
      | amount | down payment | message                           |
      |        | 10.00        | The loan amount cannot be empty.  |
      | 100.00 |              | The down payment cannot be empty. |
