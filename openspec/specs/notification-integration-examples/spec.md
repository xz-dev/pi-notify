# notification-integration-examples Specification

## Purpose
Provides current, independently readable and safely reusable examples for connecting pi-notify lifecycle and semantic-hook notifications to user-selected notification backends without publishing private credentials.

## Requirements

### Requirement: Each supported integration has its own guide
The public `example/` directory SHALL provide a separate Markdown guide for each supported integration: `agent_notify`, `ask_user_question`, `pi-continue-watchdog`, `pi-reflect-watchdog`, ntfy delivery, and Bark delivery. Guides SHALL identify their producer or backend boundary, installation inputs, configuration shape, observable notification fields, local verification path, and relevant safety limitations.

#### Scenario: User selects one integration
- **WHEN** a user opens an integration guide without reading another guide first
- **THEN** the guide contains enough information to install or connect that integration and links to shared prerequisites without requiring a private local configuration

#### Scenario: Continue and Reflect are selected separately
- **WHEN** a user wants only Continue or only Reflect notifications
- **THEN** `pi-continue-watchdog.md` and `pi-reflect-watchdog.md` describe their respective hooks independently and do not require the other producer

### Requirement: Watchdog examples reflect current neutral hook contracts
The Continue and Reflect guides SHALL document the current neutral channel and exact producer-owned fields. Continue SHALL cover `watchdog-continued` with `REASON_TYPE`/`REASON`, `watchdog-waiting` with `REASON`/decimal `WAIT_SECONDS` and no reason type, and `user-ready` with its automatic terminal kinds. Reflect SHALL cover `reflection-completed` with `REFLECTION_TYPE`, `REASON`, and `NEXT_STEP`, including `NO_ISSUE` and `ROUTE_CORRECTION`.

#### Scenario: User configures timed wait
- **WHEN** a user copies the Continue wait binding
- **THEN** the example uses `WAIT_SECONDS` as a decimal string, preserves the reason, and does not invent or send `REASON_TYPE`

#### Scenario: User configures reflection completion
- **WHEN** a valid reflection completion reaches the configured binding
- **THEN** the example presents both supported reflection types and treats producer clipping and durable completion as producer-owned behavior

#### Scenario: User encounters a silent producer state
- **WHEN** the producer is in an intermediate, cancelled, human-owned, stale, or invalid state covered by its contract
- **THEN** the guide states that no notification is expected and does not suggest inferring that state in pi-notify

### Requirement: Backend helpers are independently composable
The public examples SHALL provide separate runnable ntfy and Bark helpers. Each helper SHALL consume the existing `PI_NOTIFY_*` context plus a documented mode, publish only to its selected backend, and be usable alone or alongside the other helper through separate actions. Neither helper SHALL require the other helper or expose a private endpoint or credential. The ntfy helper SHALL accept `NTFY_URL` as a complete topic URL and publish to its host root with the topic in the JSON body. The Bark helper SHALL accept `BARK_URL` as the configured push endpoint and `BARK_DEVICE_KEY` separately, placing the device key in its JSON body.

#### Scenario: User selects only ntfy
- **WHEN** a configuration invokes the ntfy helper for a supported mode
- **THEN** exactly the ntfy request contract is used and Bark is not contacted or required

#### Scenario: Question text is supplied through stdin
- **WHEN** either helper is invoked with `question` and the question body is supplied on standard input
- **THEN** it reads that invocation's complete UTF-8 stdin stream, sends the body without using a temporary file or `PI_NOTIFY_QUESTION_BODY`, and keeps concurrent invocations isolated

#### Scenario: User selects only Bark
- **WHEN** a configuration invokes the Bark helper for a supported mode
- **THEN** exactly the Bark JSON push contract is used and ntfy is not contacted or required

#### Scenario: User composes both backends
- **WHEN** two separate actions invoke the ntfy and Bark helpers for one binding
- **THEN** each backend receives the same logical title/body presentation independently, and one backend's failure does not prevent the other action from being attempted by pi-notify

### Requirement: Public helper modes match current presentation inputs
Both public helpers SHALL support the documented reusable modes `question`, `agent`, `continue`, `wait`, `reflect`, and `user-ready`. They SHALL validate required fields, preserve multiline message bodies and safe metadata handling, remain silent for incomplete or unsupported presentations, and bound network requests with a finite timeout.

#### Scenario: Continue or wait mode has complete fields
- **WHEN** the helper receives valid Continue fields or a positive decimal wait duration plus reason
- **THEN** it emits the corresponding status presentation and appends the session identifier according to its documented format

#### Scenario: Reflection mode receives a supported type
- **WHEN** the helper receives `NO_ISSUE` or `ROUTE_CORRECTION` with non-empty reason and next step
- **THEN** it emits the corresponding fixed presentation and preserves the next-step text in the body

#### Scenario: Required field is missing
- **WHEN** a mode lacks a required field or contains an invalid wait duration
- **THEN** the helper exits without making a backend request

#### Scenario: Backend rejects a request
- **WHEN** the backend returns a non-success HTTP status or Bark returns a numeric response `code` other than `200`
- **THEN** the helper reports a bounded backend-specific diagnostic and exits unsuccessfully without printing credentials or full payloads

#### Scenario: Bark response omits a numeric result code
- **WHEN** Bark returns a successful HTTP response whose body is malformed, empty, or lacks a numeric `code`
- **THEN** the helper treats the HTTP-successful delivery as accepted and does not print the response body

### Requirement: Helper credentials stay user-owned
Public helper source SHALL contain only explicit placeholders or documented user-supplied configuration mechanisms for ntfy topics, Bark endpoints, and Bark device keys. Guides SHALL instruct users to keep credential-bearing files owner-only and SHALL prohibit committing populated credentials. Public tests and reports SHALL use local loopback endpoints or equivalent isolated fixtures and SHALL NOT send real notifications.

#### Scenario: Repository is inspected for secrets
- **WHEN** public helper files, examples, and tests are reviewed
- **THEN** no private endpoint, topic, device key, authorization value, or production payload is present

#### Scenario: User performs local verification
- **WHEN** a user follows the documented verification procedure
- **THEN** requests are captured by a local test server or fixture and no external notification service is contacted

### Requirement: Existing public entry points remain usable
The refresh SHALL preserve existing example paths and update root navigation and cross-links so users can discover all integration and backend guides from the README and related sections. Existing single-ntfy recipes SHALL remain valid while gaining an explicit path to the split backend helpers.

#### Scenario: Existing link is followed
- **WHEN** a user opens `example/agent-notify.md`, `example/rpiv-ask-user-question.md`, or `example/pi-continue-watchdog.md`
- **THEN** the path still exists and its instructions reference current helper names and configuration semantics

#### Scenario: User starts at README
- **WHEN** a user follows the Examples section from `README.md`
- **THEN** the section links to each integration guide and each backend helper guide
