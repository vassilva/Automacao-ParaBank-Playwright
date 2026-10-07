@transfer
Feature: Transfer funds between customer accounts
  As a ParaBank customer
  I want to transfer funds between my accounts
  So that I can manage my money

  # Every scenario acts as a signed-in customer of its own: sign-in is proven before the scenario
  # and sign-out is proven at its end.
  Background:
    Given I am a registered ParaBank customer who is signed out
    And I sign in with my credentials
    And I am signed in as that customer

  Scenario Outline: Transfer funds between two eligible accounts
    Given I have two eligible accounts
    When I transfer <amount> dollars from my source account to my destination account
    Then the transfer should be confirmed for <amount> dollars between those accounts
    And my source account balance should decrease by <amount> dollars
    And my destination account balance should increase by <amount> dollars
    And the transfer should be recorded once in each account's transactions
    When I sign out
    Then my banking session should be ended

    @smoke @sanity @regression @p0
    Examples: A typical amount
      | amount |
      | 128.45 |

    @regression @p1
    Examples: The smallest currency unit
      | amount |
      | 0.01   |

  Scenario Outline: A transfer with <case> is rejected and moves no money
    Given I have two eligible accounts
    When I submit a transfer of "<amount>" dollars from my source account to my destination account
    Then the transfer should not be confirmed
    And no money should have moved in any of my accounts
    When I sign out
    Then my banking session should be ended

    @regression @p1
    Examples: No amount
      | case      | amount |
      | no amount |        |

    @p2
    Examples: An amount that is not a number
      | case                           | amount |
      | an amount that is not a number | abc    |

  # Known defects (docs/defects.md): these scenarios state the correct behavior and fail until
  # the defect is fixed. They are not part of any gating suite. The defect proof fails first, so
  # the sign-out steps run only once the defect is fixed.

  @known-defect @PB-09 @p2
  Scenario Outline: The customer is told why a transfer amount is invalid
    Given I have two eligible accounts
    When I submit a transfer of "<amount>" dollars from my source account to my destination account
    Then I should be told "<message>"
    And no money should have moved in any of my accounts
    When I sign out
    Then my banking session should be ended

    Examples:
      | amount | message                      |
      |        | The amount cannot be empty.  |
      | abc    | Please enter a valid amount. |

  @known-defect
  Scenario Outline: A transfer of <case> is rejected and moves no money
    Given I have two eligible accounts
    When I submit a transfer of "<amount>" dollars from my source account to my destination account
    Then no money should have moved in any of my accounts
    And the transfer should not be confirmed
    When I sign out
    Then my banking session should be ended

    @PB-04 @p0
    Examples: A negative amount would move money in reverse
      | case              | amount |
      | a negative amount | -5.00  |

    @PB-07 @p2
    Examples: A zero amount would post empty transactions
      | case          | amount |
      | a zero amount | 0.00   |

    @PB-08 @p1
    Examples: Sub-cent precision would corrupt the account
      | case                       | amount |
      | a fraction of a cent       | 0.001  |
