## Purpose

Defines how a user creates, edits, deletes, and retrieves their financial transactions while preventing access to transactions owned by another user.

## Requirements

### Requirement: Transactions belong to one owner
The system MUST associate every transaction with an internal user identifier resolved from a validated Telegram sender identity and a pre-existing user association. A request body, query parameter, or caller-supplied `owner_id` MUST NOT select or change the owner. Requests without a valid association MUST be rejected before transaction data is read or changed.

#### Scenario: Resolve the owner from an associated Telegram sender
- **WHEN** an authenticated bot request supplies a Telegram sender identity that has a valid internal user association
- **THEN** the system stores the transaction under the associated internal user identifier

#### Scenario: Reject a caller-supplied owner
- **WHEN** a request includes an `owner_id` in its body or query parameters
- **THEN** the system rejects the request and does not create or change a transaction

#### Scenario: Reject a sender without an association
- **WHEN** an authenticated bot request supplies a Telegram sender identity with no valid internal user association
- **THEN** the system rejects it without reading or changing transaction data

### Requirement: Authenticate the bot service
Every CRUD request MUST include the configured service credential in the HTTP authorization header. The backend MUST reject missing or invalid credentials before resolving Telegram identity or accessing transaction data. The credential MUST remain server-side and MUST NOT be sent to Telegram users or included in responses or logs.

#### Scenario: Accept an authenticated bot request
- **WHEN** a request contains the configured service credential and a valid Telegram sender identity
- **THEN** the system authenticates the bot service and resolves the associated internal owner

#### Scenario: Reject a missing or invalid service credential
- **WHEN** a CRUD request has no valid service credential
- **THEN** the system rejects it before querying the user association or transaction tables

#### Scenario: Require HTTPS for non-local bot API calls
- **WHEN** the configured bot API base URL uses HTTP for a non-local host
- **THEN** the backend rejects the configuration before starting the server

### Requirement: Create a valid transaction
The system MUST accept a transaction type (`expense` or `income`) and a positive monetary amount. Description is optional and defaults to the transaction type. The system MUST assign the registration date and time using its clock in UTC; callers MUST NOT override this registration timestamp. The configured currency and display locale MUST be used when presenting amounts.

#### Scenario: Create with a description
- **WHEN** an owner submits a valid type, positive amount, and description
- **THEN** the system stores the transaction with its owner and server-assigned UTC registration timestamp

#### Scenario: Create without a description
- **WHEN** an owner submits a valid type and positive amount without a description
- **THEN** the system stores the transaction with a description equal to its type

#### Scenario: Reject invalid transaction data
- **WHEN** a create request has an unsupported type, missing amount, non-positive amount, or malformed value
- **THEN** the system returns a validation error and stores no transaction

#### Scenario: Persistence fails during creation
- **WHEN** the database cannot store a valid transaction
- **THEN** the system returns an error and does not report successful registration

### Requirement: Edit an owned transaction
The system MUST allow an owner to update the supported transaction fields after validation. An update MUST NOT change the owner or registration timestamp. The system MUST treat a missing transaction and a transaction owned by someone else as not found.

#### Scenario: Update a valid owned transaction
- **WHEN** an owner submits valid changes for a transaction they own
- **THEN** the system stores the changes and returns the updated transaction

#### Scenario: Reject an invalid update
- **WHEN** an update contains an invalid type, amount, or description value
- **THEN** the system returns a validation error and leaves the stored transaction unchanged

#### Scenario: Update a missing or foreign transaction
- **WHEN** an owner requests an update for a nonexistent transaction or one belonging to another owner
- **THEN** the system returns the same not-found result and changes no data

### Requirement: Delete an owned transaction
The system MUST allow an owner to delete a transaction they own. The operation MUST be scoped to the owner, and a missing or foreign transaction MUST return the same not-found result.

#### Scenario: Delete an owned transaction
- **WHEN** an owner requests deletion of a transaction they own
- **THEN** the transaction is removed and the system confirms deletion

#### Scenario: Delete a missing or foreign transaction
- **WHEN** an owner requests deletion of a nonexistent transaction or one belonging to another owner
- **THEN** the system returns the same not-found result and leaves all other owners' data unchanged

### Requirement: List transactions with pagination
The system MUST return only the resolved internal owner's transactions in pages. Results MUST have deterministic ordering, newest registration timestamp first, with a stable tie-breaker. Pagination parameters MUST be validated, and page size limits and defaults MUST come from configuration.

#### Scenario: Retrieve a page of transactions
- **WHEN** an owner requests a page using valid pagination parameters
- **THEN** the system returns only that owner's transactions, the requested page metadata, and results in deterministic order

#### Scenario: Reject invalid pagination
- **WHEN** an owner supplies invalid pagination parameters
- **THEN** the system returns a validation error and does not silently return a different page

#### Scenario: Database fails during retrieval
- **WHEN** the database cannot retrieve the requested page
- **THEN** the system returns an error without exposing data from another owner
