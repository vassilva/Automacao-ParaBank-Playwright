@transactions
Feature: Find account transactions
  As a ParaBank customer
  I want to search my account history
  So that I can locate a specific transaction

  # Every scenario acts as a signed-in customer of its own: sign-in is proven before the scenario
  # and sign-out is proven at its end.
  Background:
    Given I am a registered ParaBank customer who is signed out
    And I sign in with my credentials
    And I am signed in as that customer

  @sanity @regression @p1
  Scenario: Find a transaction by its amount
    Given I have two eligible accounts
    And I have already transferred 37.25 dollars from my source account to my destination account
    When I search my source account's transactions for 37.25 dollars
    Then the results should list only that transfer as a 37.25 dollar debit
    When I sign out
    Then my banking session should be ended

  @p2
  Scenario Outline: Find a transaction by its <criterion>
    Given I have two eligible accounts
    And I have already transferred <amount> dollars from my source account to my destination account
    When I search my source account's transactions by the <criterion> of that transfer
    Then the results should list exactly my source account's transactions matching that <criterion>
    When I sign out
    Then my banking session should be ended

    Examples:
      | criterion      | amount |
      | transaction ID | 41.15  |
      | date           | 44.85  |
      | date range     | 46.30  |

  @p2
  Scenario: A search by amount lists every transaction with that amount
    Given I have two eligible accounts
    And I have already transferred 52.60 dollars from my source account to my destination account twice
    When I search my source account's transactions for 52.60 dollars
    Then the results should list both of those transfers as 52.60 dollar debits
    When I sign out
    Then my banking session should be ended

  @p2
  Scenario Outline: A search that matches nothing shows an empty result
    When I search my primary account's transactions by <criterion> "<value>"
    Then the transaction results should be empty
    When I sign out
    Then my banking session should be ended

    Examples:
      | criterion      | value     |
      | amount         | 999.99    |
      | transaction ID | 999999999 |

  @p2
  Scenario Outline: A search with an invalid <criterion> is refused
    When I search my primary account's transactions by <criterion> "<value>"
    Then I should be told "<message>" for the <criterion> search
    And no transaction results should be shown
    When I sign out
    Then my banking session should be ended

    Examples:
      | criterion      | value      | message                |
      | amount         | lots       | Invalid amount         |
      | transaction ID | txn        | Invalid transaction ID |
      | date           | 2026/10/06 | Invalid date format    |
      | date range     | 10.06.2026 | Invalid date format    |
