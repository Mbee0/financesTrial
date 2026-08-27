import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  CountryCode,
  Products
} from "plaid";

export function buildPlaidClient({
  plaidClientId,
  plaidSecret,
  plaidEnv
}) {
  const configuration = new Configuration({
    basePath: PlaidEnvironments[plaidEnv],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": plaidClientId,
        "PLAID-SECRET": plaidSecret
      }
    }
  });

  return new PlaidApi(configuration);
}

export async function createPlaidLinkToken(plaidClient, { userId, redirectUri }) {
  const request = {
    user: {
      client_user_id: userId
    },
    client_name: "Secure Budget Dashboard",
    language: "en",
    country_codes: [CountryCode.Us],
    products: [Products.Transactions]
  };

  if (redirectUri) {
    request.redirect_uri = redirectUri;
  }

  const response = await plaidClient.linkTokenCreate(request);
  return response.data.link_token;
}

export async function exchangePublicToken(plaidClient, publicToken) {
  const response = await plaidClient.itemPublicTokenExchange({
    public_token: publicToken
  });

  return {
    accessToken: response.data.access_token,
    itemId: response.data.item_id
  };
}

export async function fetchAccountBalances(plaidClient, accessToken) {
  const response = await plaidClient.accountsBalanceGet({
    access_token: accessToken
  });

  return response.data.accounts.map((account) => ({
    id: account.account_id,
    name: account.name,
    officialName: account.official_name ?? null,
    type: account.type,
    subtype: account.subtype ?? null,
    mask: account.mask ?? null,
    balances: {
      available: account.balances.available ?? null,
      current: account.balances.current ?? null,
      isoCurrencyCode: account.balances.iso_currency_code ?? "USD"
    }
  }));
}

export async function removePlaidItem(plaidClient, accessToken) {
  await plaidClient.itemRemove({
    access_token: accessToken
  });
}
