---
description: Implementing a new API endpoint
---

Follow these steps whenever implementing a new endpoint in this codebase:

1. Implement the controller handler in the appropriate controller file under `src/controllers/`.
2. Import the new handler and register the route in the appropriate route file under `src/routes/`.
3. At the very end of the conversation, always output a **Postman-ready test block** in this exact format:

---

### 🧪 Test — `METHOD /api/path`

**Request**
- **Method**: `METHOD`
- **URL**: `http://localhost:4000/api/path`
- **Headers**:
  ```
  Authorization: Bearer <token>
  Content-Type: application/json
  ```
- **Body** (raw JSON):
  ```json
  {
    // full example request body
  }
  ```

**Expected Response — `STATUS`**
```json
{
  // full example response body with realistic values
}
```

---

Use realistic placeholder values (not empty strings or nulls). The token reminder should always be included for authenticated routes.
