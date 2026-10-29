

title: "Business Requirements Document — WeighingMS" version: "1.1 (draft)" status: draft client: FCI vendor: "WeighingMS project team" created: 2026-08-04 updated: 2026-08-04 source_documents:

brief.md (2026-08-04)
addendum.md (2026-08-04)
weighing-flow-diagrams.md (2026-08-04)


Business Requirements Document — WeighingMS
Assisted dyestuff weighing station integrated with OrgaTEX MES Client: FCI · Version: 1.1 draft · Date: 4 August 2026


⚠️ Read this before anything else
This version deliberately assumes answers that FCI has not yet given.

The product brief carries 41 open questions. Waiting for them would stall the project, so V1 proceeds on positively-stated assumptions — the OrgaTEX API exists and is documented, the scales stream weight continuously, and the data model is one we have defined ourselves.

Every such assumption is registered in §12 with an ID (A-01 … A-15). Every requirement that depends on one cites it inline. When FCI answers, look up the assumption, follow its references, and revise only what it touches. Do not read this document as agreed requirements — read it as a complete, self-consistent proposal that FCI can now argue with concretely.

Nothing in this document has been confirmed by FCI.


Table of contents
Purpose and audience
Business context
Business objectives
Stakeholders
Scope
Business process — as-is and to-be
Business requirements
Functional requirements
Data requirements and data model
Integration requirements
Non-functional requirements
Assumptions register
Constraints and dependencies
Risks
Acceptance criteria
Glossary


1. Purpose and audience
This document states what the business needs from WeighingMS and why. It does not state how the system will be built — that is the PRD and the architecture.

Audience
What they should get from it
FCI management
Confirmation that we understand the business problem, and a scope they can approve
FCI production and IT
Something concrete to correct — especially §9, §10 and §12
Our project team
The agreed basis for the PRD, estimates and the quotation


How to review it: read §12 first. If an assumption is wrong, say so — that is more valuable than line-editing the requirements built on top of it.


2. Business context
FCI operates a textile dyeing facility running OrgaTEX MES (SETEX, Germany) for production planning and recipe management. Every dye batch begins with an operator weighing powder dyestuffs and auxiliaries against a recipe. That weighing step determines whether the batch achieves the target shade.

Today the step is manual and unrecorded A-13. The recipe is issued on paper, the operator weighs by eye against a printed figure, and what was actually dispensed is never captured. When a batch fails shade approval, there is no record distinguishing a bad recipe from a bad weighing — so the failure cannot be attributed, and the same error recurs.

WeighingMS closes that loop. It places a guided weighing station between OrgaTEX and the operator: the recipe arrives digitally, the correct scale is selected automatically, dispensing is guided in real time against the target, out-of-tolerance weights are refused, and actual consumption is written back to OrgaTEX against the batch.

The system deliberately does not automate dispensing. The operator still dispenses by hand and a worker still carries the container to the dyeing machine. FCI has chosen accuracy and traceability over labour reduction.


3. Business objectives
ID
Objective
Measure
Baseline
BO-01
Eliminate out-of-tolerance dyestuff weighings reaching production
% of batches dispensed with all components inside tolerance
To be established A-14
BO-02
Establish component-level traceability for every dye batch
% of weighings with operator, timestamp, scale, lot and actual quantity recorded
0% today
BO-03
Reduce shade-related rework attributable to weighing error
Re-dye rate attributable to weighing
To be established A-14
BO-04
Reconcile actual dyestuff consumption against theoretical
Variance between issued and theoretical consumption per period
Not measured today
BO-05
Reduce time to investigate a shade failure
Time from failure report to identified cause
Not measured today
BO-06
Preserve or improve operator throughput
Time to weigh a complete batch vs the current paper process
To be established A-14


BO-06 is a guard, not a goal. If the station is slower than paper, operators will bypass it and every other objective fails with it.


4. Stakeholders
Stakeholder
Interest
Involvement
Weighing operator
Primary user. Needs a station that is faster and less stressful than paper
Daily user; must be involved in UI acceptance
Dyehouse supervisor
Batch progress, hold-ups, tolerance failures, override authority
Daily; approves overrides
Lab / QA
Weighed-vs-recipe record when investigating shade failure
On exception
Store / inventory
Actual consumption for stock reconciliation and lot control
Periodic
FCI IT
OrgaTEX access, network, deployment, backup, support
Project phase, then support
FCI management
Business case, scope approval, acceptance sign-off
Gates
SETEX
Owner of OrgaTEX and its interface
Dependency — see D-01
Project team (us)
Delivery
Throughout



5. Scope
5.1 In scope
Barcode-driven batch selection from the OrgaTEX batch queue
Digital recipe retrieval per batch
Automatic scale selection between the precision and floor scales, per component
Container tare handling and dyestuff identity verification
Real-time guided weighing with live target-vs-actual feedback
Tolerance enforcement at confirmation
Surplus compensation for over-dosed components
Supervisor override with logging
Dyestuff lot capture and component-level traceability
Actual-consumption write-back to OrgaTEX
Weighing ticket and label printing
Offline operation with deferred synchronisation
Operator identification
Basic operational reporting
5.2 Out of scope
Any connection to, or control of, a dispensing machine or automated dyestuff kitchen
Automated transport of weighed containers
Dissolving stations, liquid chemical dosing, salt and soda bulk systems
Recipe authoring or modification — recipes originate in and remain owned by OrgaTEX
Replacing or modifying any OrgaTEX functionality
Laboratory colour matching or shade approval
Procurement, dyestuff purchasing, or supplier management
Machine-side dyeing control
5.3 Scope boundaries requiring confirmation
Item
V1 position
Assumption
Number of stations
One station, extensible to several
A-11
Number of sites
Single site
A-11
Materials weighed
Powder dyestuffs and dry auxiliaries (salt, soda ash)
A-12
Future automation
Not a V1 concern; architecture must not preclude it
A-11



6. Business process — as-is and to-be
6.1 As-is (assumed) A-13
flowchart LR

    A["OrgaTEX issues<br/>batch and recipe"] --> B["Recipe printed<br/>on paper"]

    B --> C["Operator locates<br/>dyestuffs in store"]

    C --> D["Operator weighs<br/>by eye against printed figure"]

    D --> E["Container carried<br/>to dyeing machine"]

    E --> F{"Shade<br/>approved?"}

    F -- Yes --> G(["Batch proceeds"])

    F -- No --> H["Re-dye — cause<br/>cannot be attributed"]

    H --> C

    classDef gap stroke-dasharray: 5 4,stroke-width:2px

    class D,H gap

The dashed steps are where value leaks: the weighing itself is unguided and unrecorded, so a shade failure cannot be traced back to it.
6.2 To-be
flowchart TD

    A["OrgaTEX batch queue"] --> B["Operator scans batch barcode"]

    B --> C["WeighingMS retrieves recipe<br/>and component list"]

    C --> D["Select next component"]

    D --> E["System selects scale<br/>and loads tolerance"]

    E --> F["Operator places container;<br/>tare and dyestuff identity verified"]

    F --> G["Guided dispensing —<br/>live target vs actual"]

    G --> H{"Inside<br/>tolerance?"}

    H -- Below --> G

    H -- Inside --> I["Operator confirms"]

    H -- Above --> J{"Compensable?"}

    J -- Yes --> K["Remaining components recalculated"]

    K --> I

    J -- No --> L{"Supervisor<br/>override?"}

    L -- Approved --> I

    L -- Rejected --> M["Discard and re-weigh"]

    M --> F

    I --> N["Weighing recorded:<br/>actual, lot, operator, scale, time"]

    N --> O{"More<br/>components?"}

    O -- Yes --> D

    O -- No --> P["Consumption posted to OrgaTEX"]

    P --> Q["Ticket and label printed"]

    Q --> R["Worker carries container<br/>to dyeing machine"]
6.3 What changes for the business
Aspect
As-is
To-be
Recipe delivery
Paper
On-screen, from OrgaTEX
Scale choice
Operator judgement
Automatic, per component
Dispensing feedback
None
Live target vs actual
Out-of-tolerance weight
Undetected
Refused, or overridden with a logged reason
Over-dose handling
Undetected
Compensated or escalated
Consumption record
None
Every component, with lot and operator
Shade-failure investigation
Guesswork
Weighed-vs-recipe record per component
Inventory reconciliation
Theoretical only
Theoretical vs actual



7. Business requirements
Requirements are business-level statements of need. Priority uses MoSCoW.
7.1 Batch and recipe
ID
Requirement
Priority
Objective
Assumption
BR-01
The business must receive its weighing work from OrgaTEX, not from a separately maintained list
Must
BO-02
A-01
BR-02
An operator must be able to start work on a batch by scanning its identifier
Must
BO-06
A-10
BR-03
The business must not permit weighing against a batch OrgaTEX has not released
Must
BO-01
A-01
BR-04
Recipes must remain owned and authored in OrgaTEX; the station consumes them read-only
Must
—
A-01

7.2 Weighing accuracy
ID
Requirement
Priority
Objective
Assumption
BR-05
Each component must be weighed on the scale appropriate to its quantity, chosen by the system rather than the operator
Must
BO-01
A-06
BR-06
The operator must be able to see, while dispensing, how far the current weight is from target
Must
BO-01, BO-06
A-05
BR-07
The business must not accept a component weighed outside its tolerance without explicit authorisation
Must
BO-01
A-07
BR-08
Where a component is over-dosed, the business must have a defined response rather than an ad-hoc one
Must
BO-01
A-08
BR-09
Tolerances must be defined per component and must originate from OrgaTEX where available
Should
BO-01
A-07
BR-10
The identity of the dyestuff being weighed must be verified before dispensing is accepted
Must
BO-01
A-10

7.3 Traceability
ID
Requirement
Priority
Objective
Assumption
BR-11
Every weighing must be permanently recorded with target, actual, operator, scale, timestamp and dyestuff lot
Must
BO-02
A-09
BR-12
Actual consumption must reach OrgaTEX against the correct batch
Must
BO-04
A-02
BR-13
Every tolerance override must record who authorised it and why
Must
BO-02
A-08
BR-14
The business must be able to reconstruct, for any past batch, exactly what was weighed
Must
BO-05
A-09
BR-15
A physical record must accompany the weighed container to the dyeing machine
Must
BO-02
A-04

7.4 Continuity
ID
Requirement
Priority
Objective
Assumption
BR-16
A network or OrgaTEX outage must not stop weighing that is already in progress
Must
BO-06
A-03
BR-17
Work performed during an outage must reach OrgaTEX once connectivity returns, without re-keying
Must
BO-04
A-03
BR-18
The business must be able to see which weighings have not yet reached OrgaTEX
Should
BO-04
A-03

7.5 Operations and people
ID
Requirement
Priority
Objective
Assumption
BR-19
Each weighing must be attributable to an identified operator
Must
BO-02
A-09
BR-20
The station must be operable by an operator wearing gloves in a dusty environment
Must
BO-06
A-14
BR-21
The station must be usable in the operators' working language
Must
BO-06
A-10
BR-22
A supervisor must be able to see batch weighing progress without visiting the station
Should
BO-05
A-11
BR-23
The business must be able to report on tolerance failures and overrides over a period
Should
BO-01, BO-03
A-11
BR-24
Scale calibration status must be visible, and weighing on an out-of-calibration scale must be prevented
Should
BO-01
A-06



8. Functional requirements
High-level functional expression of §7. Detailed behaviour belongs in the PRD.
8.1 Batch selection
FR-01 Retrieve and display the batch queue released for this station from OrgaTEX A-01
FR-02 Select a batch by barcode scan, or by touch from the displayed queue
FR-03 Reject selection of a batch not in a released state, with the reason shown
FR-04 Display batch context: order, machine, fabric, shade, component count
FR-05 Retrieve the recipe and its component list on selection
8.2 Component preparation
FR-06 Present components in recipe sequence, with completed, active and pending states
FR-07 Determine the target scale from the component target quantity against the scale-selection rule A-06
FR-08 Display the selected scale and allow supervisor-authorised manual reselection
FR-09 Verify dyestuff identity by barcode scan against the recipe component A-10
FR-10 Capture the dyestuff lot being consumed A-09
FR-11 Apply the container tare, either from the container master or by weighing the empty container
FR-12 Prevent progression if scale calibration has expired A-06
8.3 Guided weighing
FR-13 Display live weight from the selected scale, updating continuously A-05
FR-14 Display target, weighed-so-far, and still-to-weigh
FR-15 Display a graphical progress indicator with the tolerance band marked
FR-16 Signal visually when the weight enters tolerance
FR-17 Signal distinctly when the weight exceeds tolerance
FR-18 Permit confirmation only while the weight is inside tolerance, or after authorised override
FR-19 Allow the operator to abandon a component and restart it
8.4 Over-dose handling
FR-20 Detect an over-dose and calculate the surplus
FR-21 Determine compensability against the compensation rule A-08
FR-22 Where compensable, calculate revised targets for all remaining components preserving recipe ratio, and present them for acceptance
FR-23 Where not compensable, offer supervisor override or discard-and-re-weigh
FR-24 Record the compensation or override applied, with authorising user and reason A-08
8.5 Recording and output
FR-25 Record each confirmed weighing with the full traceability set A-09
FR-26 Post batch consumption to OrgaTEX on batch completion A-02
FR-27 Print a weighing ticket on batch completion A-04
FR-28 Permit ticket reprint, marked as a reprint
FR-29 Provide batch weighing history retrievable by batch, date, operator or dyestuff A-09
8.6 Continuity
FR-30 Continue operating on locally held recipe and master data when OrgaTEX is unreachable A-03
FR-31 Queue unsynchronised records and transmit them automatically on reconnection
FR-32 Display connection state and unsynchronised record count
FR-33 Surface synchronisation failures for manual attention
8.7 Users
FR-34 Identify the operator at session start A-09
FR-35 Require supervisor authentication for override, manual scale reselection and calibration bypass
FR-36 Record all privileged actions to the audit trail
FR-37 Present the interface in the configured language A-10


9. Data requirements and data model
This model is our definition, not FCI's or SETEX's A-09. It is presented so FCI can correct entity names, cardinalities and field-level expectations against how they actually work. Terminology in particular is likely to differ — see addendum.md §E.
9.1 Entity relationship model
erDiagram

    BATCH ||--|| RECIPE : "dispenses"

    RECIPE ||--|{ RECIPE_COMPONENT : "contains"

    RECIPE_COMPONENT }o--|| DYESTUFF : "specifies"

    RECIPE_COMPONENT }o--|| TOLERANCE_RULE : "governed by"

    DYESTUFF ||--o{ DYESTUFF_LOT : "supplied as"

    BATCH ||--o| WEIGHING_SESSION : "weighed in"

    WEIGHING_SESSION ||--|{ WEIGHING_RECORD : "produces"

    WEIGHING_SESSION }o--|| OPERATOR : "performed by"

    WEIGHING_SESSION }o--|| STATION : "at"

    WEIGHING_RECORD }o--|| RECIPE_COMPONENT : "fulfils"

    WEIGHING_RECORD }o--|| DYESTUFF_LOT : "consumes"

    WEIGHING_RECORD }o--|| CONTAINER : "into"

    WEIGHING_RECORD }o--|| SCALE : "measured on"

    WEIGHING_RECORD ||--o{ COMPENSATION : "triggers"

    WEIGHING_RECORD ||--o| OVERRIDE : "authorised by"

    STATION ||--|{ SCALE : "equipped with"

    WEIGHING_SESSION ||--o{ SYNC_ENTRY : "queues"

    WEIGHING_SESSION ||--|{ AUDIT_EVENT : "logs"
9.2 Entity definitions
BATCH — sourced from OrgaTEX; weighing status written back A-01 A-02
Field
Type
Notes
batch_id
string, PK
OrgaTEX batch identifier, e.g. B-24187
order_ref
string
Sales/production order
machine_ref
string
Target dyeing machine
fabric_desc
string
Substrate description
fabric_weight_kg
decimal
Drives recipe quantities
shade_code
string
Target shade
recipe_id
string, FK


status
enum
QUEUED RELEASED WEIGHING WEIGHED CANCELLED
released_at
timestamp


synced_at
timestamp
Local — last refresh from OrgaTEX


Batch is the one OrgaTEX entity WeighingMS writes to. All other OrgaTEX-sourced entities are strictly read-only. WeighingMS advances status to WEIGHING and WEIGHED via IR-06, and posts consumption via IR-05. It never alters any other batch field.
RECIPE — sourced from OrgaTEX, read-only
Field
Type
Notes
recipe_id
string, PK


shade_code
string


version
string
Recipes are versioned; the batch pins a version
component_count
integer



RECIPE_COMPONENT — sourced from OrgaTEX, read-only
Field
Type
Notes
component_id
string, PK


recipe_id
string, FK


sequence
integer
Weighing order
dyestuff_id
string, FK


target_qty
decimal(12,4)


uom
enum
g kg
tolerance_rule_id
string, FK


is_compensable
boolean
Whether over-dose may be compensated A-08

DYESTUFF — sourced from OrgaTEX master data A-01
Field
Type
Notes
dyestuff_id
string, PK


code
string
FCI article code
name
string


type
enum
DYE AUXILIARY SALT ALKALI
default_uom
enum


colour_hex
string
Local — operator identification aid
barcode
string
For identity verification A-10

DYESTUFF_LOT
Field
Type
Notes
lot_id
string, PK
Supplier lot
dyestuff_id
string, FK


supplier
string


received_at
date



TOLERANCE_RULE A-07
Field
Type
Notes
rule_id
string, PK


mode
enum
PERCENT ABSOLUTE BANDED
value
decimal
Percentage or absolute, per mode
min_abs
decimal
Floor, so small quantities do not get an unachievable band
max_abs
decimal
Ceiling

CONTAINER
Field
Type
Notes
container_id
string, PK


type
enum
DRUM BUCKET BAG
tare_qty
decimal
Known tare, where containers are reusable
tare_source
enum
MASTER WEIGHED
in_service
boolean



STATION
Field
Type
Notes
station_id
string, PK
e.g. STN-01
name
string
Display name, e.g. "Weighing Station 01"
location
string
Position in the dyehouse
status
enum
ACTIVE MAINTENANCE RETIRED
printer_id
string
Configured ticket printer
scanner_id
string
Configured barcode scanner
language
string
Configured interface language A-10

SCALE A-05 A-06
Field
Type
Notes
scale_id
string, PK


station_id
string, FK


class
enum
PRECISION FLOOR
capacity
decimal
e.g. 3 kg, 32 kg
resolution
decimal
Smallest increment
protocol
string
e.g. RS232-CONTINUOUS
last_calibrated_at
date


calibration_due_at
date
Blocks use when passed A-06

WEIGHING_SESSION
Field
Type
Notes
session_id
uuid, PK


batch_id
string, FK


station_id
string, FK


operator_id
string, FK


started_at / completed_at
timestamp


status
enum
IN_PROGRESS COMPLETED ABANDONED
sync_status
enum
PENDING SYNCED FAILED A-03

WEIGHING_RECORD — the core traceability record A-09
Field
Type
Notes
record_id
uuid, PK


session_id
uuid, FK


component_id
string, FK


lot_id
string, FK


container_id
string, FK


scale_id
string, FK


target_qty
decimal(12,4)
Snapshot at weighing time
actual_qty
decimal(12,4)


uom
enum


tolerance_min / tolerance_max
decimal
Snapshot — rules may change later
result
enum
IN_TOLERANCE COMPENSATED OVERRIDDEN
surplus_qty
decimal
Nullable
operator_id
string, FK


confirmed_at
timestamp




Snapshotting target and tolerance onto the record is deliberate. If a recipe or tolerance rule is later revised in OrgaTEX, the historical record must still show what the operator was actually asked to hit. Without this, BR-14 cannot be met.
COMPENSATION A-08
Field
Type
Notes
compensation_id
uuid, PK


trigger_record_id
uuid, FK
The over-dosed weighing
affected_component_id
string, FK


original_target / adjusted_target
decimal


factor
decimal
Applied ratio
accepted_by
string, FK



OVERRIDE A-08
Field
Type
Notes
override_id
uuid, PK


record_id
uuid, FK


authorised_by
string, FK
Supervisor
reason
string
Mandatory
authorised_at
timestamp



OPERATOR
Field
Type
Notes
operator_id
string, PK


name
string


badge_id
string
Identification method A-09
role
enum
OPERATOR SUPERVISOR
active
boolean



SYNC_ENTRY A-03
Field
Type
Notes
entry_id
uuid, PK


entity_type / entity_id
string
What is pending
payload
json
Serialised for transmission
created_at
timestamp


attempts
integer


status
enum
PENDING SENT FAILED

AUDIT_EVENT
Field
Type
Notes
event_id
uuid, PK


session_id
uuid, FK


type
enum
OVERRIDE SCALE_RESELECT CAL_BYPASS REPRINT ABANDON
actor_id
string, FK


detail
json


occurred_at
timestamp



9.3 Data ownership
Data
Master
WeighingMS role
Batch header
OrgaTEX
Read and cache; write weighing status back (IR-06)
Recipe, component, tolerance
OrgaTEX
Read, cache locally
Dyestuff master
OrgaTEX
Read, cache locally
Dyestuff lot
OrgaTEX if available, else WeighingMS A-09
Read or master
Container master
WeighingMS
Master
Scale configuration and calibration
WeighingMS
Master
Operator
WeighingMS, or FCI directory A-09
Master
Weighing records, compensations, overrides, audit
WeighingMS
Master; posts summary to OrgaTEX
Actual consumption
OrgaTEX
Write

9.4 Retention
DR-01 Weighing records, compensations, overrides and audit events retained for a minimum of 5 years A-14
DR-02 Records are immutable once confirmed; corrections are new records referencing the original
DR-03 Cached OrgaTEX master data is refreshed on a schedule and on demand; it is never authoritative


10. Integration requirements
10.1 OrgaTEX — assumed REST API A-01 A-02
V1 assumes SETEX provides a documented, licensed REST API over HTTPS returning JSON, reachable from the station network. If the real interface is OPC-UA, a direct database, or file exchange, §10.1 changes but nothing else in this document does — that isolation is the point of the adapter in IR-07.

ID
Requirement
Direction
IR-01
Retrieve batches released for a station, filterable by status
Read
IR-02
Retrieve the recipe and component list for a batch, including target quantities, units and tolerances
Read
IR-03
Retrieve dyestuff master data
Read
IR-04
Retrieve dyestuff lot data where OrgaTEX holds it
Read
IR-05
Post actual consumption per component against a batch
Write
IR-06
Update batch weighing status
Write


Assumed endpoint shape — illustrative, for FCI/SETEX to correct:

GET  /api/v1/stations/{stationId}/batches?status=released

GET  /api/v1/batches/{batchId}

GET  /api/v1/batches/{batchId}/recipe

GET  /api/v1/dyestuffs

GET  /api/v1/dyestuffs/{dyestuffId}/lots

POST /api/v1/batches/{batchId}/consumption

PATCH /api/v1/batches/{batchId}/status

Authentication assumed to be OAuth2 client credentials or an API key over TLS A-01.

ID
Requirement
IR-07
All OrgaTEX interaction is confined to a single adapter component, so a change of interface technology affects one replaceable part
IR-08
Consumption posting is idempotent — a retry after an ambiguous failure must not double-post
IR-09
Interface failures are logged with enough detail to diagnose without OrgaTEX-side access

10.2 Scales A-05
ID
Requirement
IR-10
Read a continuous weight stream from each scale indicator at no less than 10 readings per second
IR-11
Interpret the indicator's stability flag and distinguish settling from settled weight
IR-12
Issue a tare command, or apply tare in software where the indicator does not support it
IR-13
Detect indicator disconnection within 2 seconds and block confirmation while disconnected
IR-14
Support both scales concurrently connected

10.3 Peripherals
ID
Requirement
IR-15
Accept input from a wireless barcode scanner in keyboard-wedge or serial mode A-10
IR-16
Print to the ticket printer, with content and layout configurable without code change A-04
IR-17
Accept input from the 21-key terminal for all confirm/abandon actions available on the touchscreen A-10
IR-18
Report peripheral status to the operator continuously



11. Non-functional requirements
ID
Category
Requirement
Assumption
NFR-01
Responsiveness
Displayed weight lags the scale by no more than 200 ms. IR-10's 10 Hz sampling gives a 100 ms interval, leaving 100 ms for transport, processing and render
A-05
NFR-02
Responsiveness
Batch selection to recipe displayed within 3 seconds when online


NFR-03
Availability
Weighing remains available during OrgaTEX or network outage
A-03
NFR-04
Availability
Target station availability 99% within production hours
A-14
NFR-05
Durability
A confirmed weighing survives immediate power loss


NFR-06
Recovery
An interrupted session is resumable at the component that was in progress


NFR-07
Usability
All primary actions reachable with gloved hands; minimum touch target 15 mm


NFR-08
Usability
Weight readout legible at 1.5 m


NFR-09
Usability
Operator trainable to competence within one shift
A-14
NFR-10
Environment
Hardware rated for dust and humidity of a dyehouse floor; IP54 minimum at the station
A-14
NFR-11
Localisation
All operator-facing text externalised for translation
A-10
NFR-12
Security
Privileged actions require authentication; credentials never shared between roles


NFR-13
Auditability
Audit records immutable and exportable


NFR-14
Maintainability
Scale, tolerance, label and language configuration changeable without redeployment


NFR-15
Capacity
The station sustains FCI's actual daily batch and component volume without degradation. Figures not yet known — see A-15. A single station's practical ceiling is bounded by weighing time per batch, so this figure also determines whether one station is sufficient
A-15
NFR-16
Data integrity
Weight arithmetic uses fixed-point decimal; floating point is not permitted for quantities





12. Assumptions register
Every one of these is unconfirmed. The Source column points at the brief question that will settle it. When an answer arrives, follow the Referenced-by column and revise only those items.

ID
Assumption (stated positively)
Referenced by
Settles brief Q
Impact if wrong
A-01
SETEX provides a documented, licensed REST API over HTTPS exposing batch queue, recipe, components, tolerances and dyestuff master, reachable from the station network
BR-01, BR-03, BR-04, FR-01, FR-05, IR-01–04, §9.2
Q6–Q10
Severe. If no interface exists, the project premise fails. If it is OPC-UA/DB/file, §10.1 is rewritten and the adapter absorbs it
A-02
OrgaTEX accepts actual-consumption postings from an external system against a batch
BR-12, FR-26, IR-05, IR-06
Q11, Q12
Severe. Without write-back, BO-04 is unachievable and consumption stays in WeighingMS only
A-03
Weighing must continue through an OrgaTEX outage and synchronise afterwards
BR-16–18, FR-30–33, NFR-03, SYNC_ENTRY
Q13
Moderate. If FCI prefers the station to stop, the sync subsystem is dropped — a simplification
A-04
A ticket printer is present; label content is configurable and defined by FCI
BR-15, FR-27, IR-16
Q18
Low
A-05
Scale indicators stream weight continuously at ≥10 Hz with a stability flag, over a documented serial or Ethernet protocol
BR-06, FR-13, IR-10–14, NFR-01
Q15, Q16
Severe. If only stabilised values are available, guided weighing is replaced by confirm-and-add and the signature interaction is redesigned
A-06
Scale selection is rule-based on component target quantity, with a defined threshold; calibration status is known to the system
BR-05, BR-24, FR-07, FR-08, FR-12
Q15, Q20
Moderate. Threshold and boundary behaviour need FCI's rule
A-07
Tolerances are per-component, expressed as a percentage with an absolute floor, and originate from OrgaTEX
BR-07, BR-09, TOLERANCE_RULE
Q24
Moderate. If FCI uses banded or per-dyestuff tolerances, the rule entity changes shape
A-08
Surplus compensation means proportionally recalculating remaining components to preserve shade ratio; non-compensable over-doses escalate to supervisor override
BR-08, BR-13, FR-20–24, COMPENSATION, OVERRIDE
Q25, Q26, Q33
High. This is the most likely misunderstanding in the document. FCI may mean only "display the excess"
A-09
Per-operator traceability is required; dyestuff lots are captured at weighing; records retained long-term
BR-11, BR-14, BR-19, FR-10, FR-25, FR-34, §9.2
Q28, Q37
Moderate
A-10
Dyestuffs carry scannable barcodes; the interface language is English; the 21-key terminal duplicates touchscreen actions
BR-02, BR-10, BR-21, FR-09, FR-37, IR-15, IR-17
Q19, Q35
Moderate. Absent barcodes make identity verification manual
A-11
One station at one site in V1, architected for several; supervisor visibility and period reporting are wanted
BR-22, BR-23, §5.3
Q30, Q32
Low for V1
A-12
Powder dyestuffs and dry auxiliaries only; no liquids in V1
§5.2, §5.3
Q23
Moderate. Liquids would add dosing considerations
A-13
Today's process is paper-based, unguided and unrecorded
§2, §6.1
Q1, Q2
High for the business case. If FCI already has a system, the justification and scope both change
A-14
Baselines, targets and environmental ratings will be set by FCI during BRD review
BO-01, BO-03, BO-06, BR-20, DR-01, NFR-04, NFR-09, NFR-10, AC-11, AC-12
Q3, Q5
Low — placeholders by design
A-15
FCI's daily batch volume and typical component count fall within a single station's throughput
NFR-15, §5.3
Q21
Moderate. If volume exceeds one station's capacity, station count and deployment architecture both change


Five assumptions are severe or high: A-01, A-02, A-05, A-08, and A-13. These should be resolved before the PRD. The remainder can be carried.


13. Constraints and dependencies
13.1 Constraints
ID
Constraint
C-01
Recipes and batch scheduling remain owned by OrgaTEX; WeighingMS must not become a second source of truth
C-02
No modification to OrgaTEX is permitted
C-03
The system must not connect to or control dispensing machinery
C-04
The station operates in an industrial dyehouse environment — dust, humidity, cleaning
C-05
Operators may have limited computer literacy; the interface must not assume otherwise
C-06
Physical scale capacities bound what can be weighed at the station

13.2 Dependencies
ID
Dependency
Owner
Needed by
D-01
SETEX provides interface documentation and any required licence
FCI, with SETEX
Before PRD sign-off
D-02
Scale indicator models and protocol documentation
FCI
Before PRD
D-03
Network access from station to OrgaTEX, with credentials
FCI IT
Before integration testing
D-04
Hardware procurement — scales, terminal, scanner, printer
To be agreed
Before installation
D-05
FCI confirms tolerance and compensation rules
FCI production
Before PRD
D-06
Operator availability for UI validation and training
FCI production
Before acceptance
D-07
Baseline metrics for BO-01, BO-03, BO-06
FCI
Before acceptance



14. Risks
ID
Risk
Likelihood
Impact
Response
R-01
SETEX does not provide, or licenses prohibitively, the OrgaTEX interface (A-01)
Medium
Severe
Confine to adapter (IR-07); escalate commercially through FCI early; identify file-exchange fallback
R-02
Scales cannot stream continuously (A-05)
Medium
Severe
Confirm before PRD; hold a confirm-and-add interaction design as fallback
R-03
Surplus compensation means something other than assumed (A-08)
High
High
Demonstrate the mockup and let FCI correct it
R-04
Business case rests on an assumed as-is process (A-13)
Medium
High
Confirm at BRD review before estimating benefit
R-05
Operators bypass the station as slower than paper
Medium
High
Treat BO-06 as an acceptance gate, not an aspiration
R-06
Hardware responsibility unresolved, delaying installation
Medium
Moderate
Settle D-04 at BRD sign-off
R-07
Scope grows through §5.3 items during PRD
Medium
Moderate
Freeze scope at BRD sign-off; changes go through change control
R-08
Dyestuff barcoding does not exist, breaking identity verification (A-10)
Medium
Moderate
Fall back to on-screen confirmation with operator attestation



15. Acceptance criteria
Business-level. Detailed test cases belong to the test plan.

ID
Criterion
AC-01
An operator selects a released batch by barcode scan and sees its correct recipe within 3 seconds
AC-02
For every component, the system selects the correct scale without operator input
AC-03
Dispensing shows live weight tracking the physical scale with no perceptible lag
AC-04
Confirmation is impossible while the weight sits outside tolerance
AC-05
An over-dose produces the agreed compensation or escalation behaviour
AC-06
An override cannot be completed without supervisor authentication and a recorded reason
AC-07
Every confirmed weighing is retrievable with target, actual, operator, scale, lot and timestamp
AC-08
Consumption for a completed batch appears correctly in OrgaTEX
AC-09
With the network disconnected, a full batch can be weighed; on reconnection all records reach OrgaTEX without re-keying or duplication
AC-10
A ticket prints with FCI's agreed content
AC-11
An operator new to the system completes a batch unaided after one shift of training A-14
AC-12
A complete batch is weighed no slower than the current paper process A-13 A-14. Unmeasurable until the current process and its baseline timing are confirmed
AC-13
All operator-facing text appears in the agreed language
AC-14
Weighing is prevented on a scale whose calibration has expired



16. Glossary
Term
Definition as used here
Batch
A dye lot scheduled by OrgaTEX, weighed as a unit. FCI may use this word differently — confirm
Recipe
The versioned formulation for a shade: components with target quantities and tolerances
Component
One dyestuff or auxiliary within a recipe, weighed individually
Tare
Weight of the empty container, excluded from the dispensed quantity
Tolerance
The acceptable range around a target within which a weighing may be confirmed
Surplus
Quantity dispensed above the tolerance maximum
Surplus compensation
Proportional recalculation of remaining component targets to preserve shade ratio after an over-dose. Assumed definition — A-08
Override
Supervisor authorisation to confirm an out-of-tolerance weighing, with recorded reason
Lot
Supplier batch of a dyestuff, tracked for traceability
Precision scale
The 3 kg scale, used for small components
Floor scale
The 32 kg scale, used for bulk auxiliaries
Station
One physical weighing position: terminal, scales, scanner, printer
OrgaTEX
FCI's MES, supplied by SETEX (Germany) — source of batches and recipes
MES
Manufacturing Execution System



Document control
Version
Date
Author
Change
1.0 draft
2026-08-04
Paige (tech writer)
Initial BRD from product brief, with assumed answers to open questions
1.1 draft
2026-08-04
Paige (tech writer)
Validation fixes: defined STATION; corrected BATCH write-back contradiction; raised scale sampling to 10 Hz; tied capacity to new assumption A-15 (brief Q21); traceability tags on BR-20, AC-11, AC-12; removed orphan qty_remaining; corrected OVERRIDE cardinality


Next revision trigger: FCI's answers to brief §9, particularly Q6–Q13 (A-01, A-02, A-03), Q15–Q16 (A-05), Q25–Q26 (A-08) and Q1–Q2 (A-13).

