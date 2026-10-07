import type { Page } from '@playwright/test';
import { AccountActivityPage } from './account-activity.page';
import { AccountServicesMenu } from './account-services.menu';
import { AccountsOverviewPage } from './accounts-overview.page';
import { BillPayPage } from './bill-pay.page';
import { CustomerCarePage } from './customer-care.page';
import { CustomerLookupPage } from './customer-lookup.page';
import { Feedback } from './feedback.component';
import { FindTransactionsPage } from './find-transactions.page';
import { HomePage } from './home.page';
import { OpenAccountPage } from './open-account.page';
import { RegistrationPage } from './registration.page';
import { RequestLoanPage } from './request-loan.page';
import { TransferFundsPage } from './transfer-funds.page';
import { UpdateProfilePage } from './update-profile.page';

export function createPages(page: Page) {
  return {
    feedback: new Feedback(page),
    home: new HomePage(page),
    menu: new AccountServicesMenu(page),
    registration: new RegistrationPage(page),
    customerLookup: new CustomerLookupPage(page),
    customerCare: new CustomerCarePage(page),
    overview: new AccountsOverviewPage(page),
    accountActivity: new AccountActivityPage(page),
    openAccount: new OpenAccountPage(page),
    transfer: new TransferFundsPage(page),
    billPay: new BillPayPage(page),
    findTransactions: new FindTransactionsPage(page),
    updateProfile: new UpdateProfilePage(page),
    requestLoan: new RequestLoanPage(page),
  };
}

export type Pages = ReturnType<typeof createPages>;
