# Sub-Account Endpoints Testing Guide (Postman / Curl)

All endpoints are relative to `http://localhost:4000/api`.

### 1. Register / Login (Get Parent Token)
First, log in with your primary account to obtain an authorization token.

**POST** `/auth/login`
```json
{
  "email": "kelvin@gmail.com",
  "password": "yourpassword"
}
```
*Note: Copy the `token` from the response for the next steps.*

---

### 2. Create a Sub-Account
Add a new account linked to the current one.

**POST** `/auth/sub-accounts`
**Headers:** `Authorization: Bearer <PARENT_TOKEN>`
```json
{
  "name": "Alex Brandon",
  "email": "alexbrandon@example.com",
  "password": "subaccountpassword123"
}
```

---

### 3. List Linked Accounts
Retrieve all accounts associated with the current parent (including the parent itself if called from a sub-account).

**GET** `/auth/sub-accounts`
**Headers:** `Authorization: Bearer <PARENT_TOKEN>`

**Response Example:**
```json
[
  {
    "id": "sub_account_id_here",
    "name": "Alex Brandon",
    "email": "alexbrandon@example.com",
    "role": "CUSTOMER"
  }
]
```

---

### 4. Switch Account
Switch context to one of the linked accounts. This returns a new token for that specific account.

**POST** `/auth/switch-account`
**Headers:** `Authorization: Bearer <PARENT_TOKEN>`
```json
{
  "targetUserId": "sub_account_id_here"
}
```
**Response:** Returns a new `token` and the `user` object for the sub-account.

---

### 5. Verify Sub-Account Session
Use the new token to verify the identity of the sub-account.

**GET** `/auth/me`
**Headers:** `Authorization: Bearer <SUB_ACCOUNT_TOKEN>`

---

### 6. Switch Back to Parent
From the sub-account, you can switch back to the parent account using its ID.

**POST** `/auth/switch-account`
**Headers:** `Authorization: Bearer <SUB_ACCOUNT_TOKEN>`
```json
{
  "targetUserId": "parent_account_id_here"
}
```
