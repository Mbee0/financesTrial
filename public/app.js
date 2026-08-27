const loginForm = document.querySelector("#login-form");
const authPanel = document.querySelector("#auth-panel");
const dashboardPanel = document.querySelector("#dashboard-panel");
const connectButton = document.querySelector("#connect-button");
const refreshButton = document.querySelector("#refresh-button");
const disconnectButton = document.querySelector("#disconnect-button");
const logoutButton = document.querySelector("#logout-button");
const statusMessage = document.querySelector("#status-message");
const connectionState = document.querySelector("#connection-state");
const accountsTable = document.querySelector("#accounts-table");
const accountsTableBody = document.querySelector("#accounts-tbody");

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    },
    ...options
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error ?? "Request failed.");
  }
  return data;
}

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", isError);
}

function setAuthenticated(authenticated) {
  authPanel.classList.toggle("hidden", authenticated);
  dashboardPanel.classList.toggle("hidden", !authenticated);
}

function renderAccounts(accounts) {
  accountsTableBody.innerHTML = "";

  if (!Array.isArray(accounts) || accounts.length === 0) {
    accountsTable.classList.add("hidden");
    return;
  }

  for (const account of accounts) {
    const row = document.createElement("tr");

    const nameCell = document.createElement("td");
    nameCell.textContent = account.officialName || account.name;
    row.appendChild(nameCell);

    const typeCell = document.createElement("td");
    typeCell.textContent = `${account.type}/${account.subtype ?? "unknown"}`;
    row.appendChild(typeCell);

    const availableCell = document.createElement("td");
    availableCell.textContent =
      account.balances.available === null ? "n/a" : String(account.balances.available);
    row.appendChild(availableCell);

    const currentCell = document.createElement("td");
    currentCell.textContent =
      account.balances.current === null ? "n/a" : String(account.balances.current);
    row.appendChild(currentCell);

    accountsTableBody.appendChild(row);
  }

  accountsTable.classList.remove("hidden");
}

async function refreshDashboard() {
  try {
    const data = await api("/api/dashboard", {
      method: "GET"
    });

    connectionState.textContent = data.connected
      ? `Connected. Last sync at ${data.syncedAt}.`
      : "Not connected to Plaid.";

    renderAccounts(data.accounts);
    setStatus("Dashboard refreshed.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function openPlaidLink() {
  if (!window.Plaid) {
    setStatus("Plaid Link failed to load.", true);
    return;
  }

  try {
    const { linkToken } = await api("/api/plaid/link-token", { method: "GET" });
    const handler = window.Plaid.create({
      token: linkToken,
      onSuccess: async (publicToken) => {
        try {
          await api("/api/plaid/exchange-public-token", {
            method: "POST",
            body: JSON.stringify({ publicToken })
          });
          setStatus("Bank connected securely through Plaid.");
          await refreshDashboard();
        } catch (error) {
          setStatus(error.message, true);
        }
      },
      onExit: () => {
        setStatus("Plaid Link closed.");
      }
    });

    handler.open();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function disconnectPlaid() {
  try {
    await api("/api/plaid/disconnect", {
      method: "POST"
    });
    connectionState.textContent = "Not connected to Plaid.";
    renderAccounts([]);
    setStatus("Disconnected from Plaid.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
    setAuthenticated(false);
    renderAccounts([]);
    connectionState.textContent = "Not connected to Plaid.";
    setStatus("Logged out.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(loginForm);
  const password = String(formData.get("password") ?? "");

  try {
    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password })
    });
    loginForm.reset();
    setAuthenticated(true);
    setStatus("Signed in.");
    await refreshDashboard();
  } catch (error) {
    setStatus(error.message, true);
  }
});

connectButton.addEventListener("click", openPlaidLink);
refreshButton.addEventListener("click", refreshDashboard);
disconnectButton.addEventListener("click", disconnectPlaid);
logoutButton.addEventListener("click", logout);

async function init() {
  try {
    const { authenticated } = await api("/api/auth/session", { method: "GET" });
    setAuthenticated(authenticated);
    if (authenticated) {
      await refreshDashboard();
    }
  } catch (error) {
    setStatus(error.message, true);
  }
}

init();
