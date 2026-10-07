@accounts
Feature: Customer accounts
  As a ParaBank customer
  I want to see my accounts and open new ones
  So that I always know where my money is

  # Every scenario acts as a signed-in customer of its own: sign-in is proven before the scenario
  # and sign-out is proven at its end.
  Background:
    Given I am a registered ParaBank customer who is signed out
    And I sign in with my credentials
    And I am signed in as that customer

  @smoke @regression @p0
  Scenario: The accounts overview matches the bank's records
    Given I have two eligible accounts
    When I view my accounts overview
    Then I should see each of my accounts with its current balance
    And the overview total should equal the sum of my balances
    When I sign out
    Then my banking session should be ended

  @regression @p1
  Scenario: An account's details page matches the bank's records
    Given I have two eligible accounts
    When I open my destination account from my accounts overview
    Then I should see that account's number, type, balance and available amount
    And I should see that account's transactions as the bank records them
    When I sign out
    Then my banking session should be ended

  @p2
  Scenario: Only checking and savings accounts can be opened online
    When I start opening a new account
    Then I should be offered exactly these account types:
      | CHECKING |
      | SAVINGS  |
    And I should be told that 100 dollars must be deposited when the account is opened
    When I sign out
    Then my banking session should be ended

  Scenario Outline: Open a new <type> account funded from an existing account
    When I open a new <type> account funded from my primary account
    Then the new account should be confirmed with its account number
    And the new account should be a <type> account holding the 100 dollar opening deposit
    And my primary account balance should decrease by 100 dollars
    And the opening deposit should be recorded as a transfer from my primary account to the new account
    When I sign out
    Then my banking session should be ended

    @sanity @regression @p0
    Examples: Savings
      | type    |
      | SAVINGS |

    @regression @p1
    Examples: Checking
      | type     |
      | CHECKING |
