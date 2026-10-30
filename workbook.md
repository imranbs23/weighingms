## **Build the Weighing MS Step by Step Using specs.md**

### **Hands-on AI-DLC Participant Workbook**

# **0. What You Are Going to Build**

You are going to build a functional **Weighing MS Assisted Dyestuff Weighing Station**.

You are given two source artifacts:

docs/  
├── brief.md  
└── customize-weighing-station.html

brief.md is the Product Brief.

customize-weighing-station.html is the supplied UI/UX prototype.

Your job is to turn these into a working application using **specs.md AI-DLC**.

The final application must reproduce the functional experience represented by the supplied UI/UX.

The real external systems are **not available**.

Therefore, you will build and use **Dummy APIs** for:

OrgaTEX  
Weighing Scale  
Scanner  
Printer

The Dummy APIs are part of your product.

# **1. What You Will Learn**

By completing this workbook you will experience:

Product Intent  
↓  
Requirements  
↓  
System Context  
↓  
Units  
↓  
Stories  
↓  
Bolts  
↓  
Construction  
↓  
Code  
↓  
Dummy APIs  
↓  
Tests  
↓  
Working Product

This is the AI-DLC flow implemented by specs.md.

The current specs.md documentation describes AI-DLC as three sequential phases:

1.  Inception

2.  Construction

3.  Operations

With comprehensive checkpoints and traceability. (⁠[GitHub](https://github.com/fabriqaai/specs.md))

# **2. Rules of the Lab**

Follow these rules throughout the exercise.

### **Rule 1 — Do not start coding immediately**

The first job is to understand and specify the product.

### **Rule 2 — Do not invent requirements silently**

If something is unclear:

Ask  
→ Record  
→ Decide  
→ Continue

### **Rule 3 — AI proposes; you validate**

When the AI generates an artifact, you review it.

Do not approve of something simply because it looks professional.

### **Rule 4 — Do not bypass checkpoints**

AI-DLC uses explicit human validation checkpoints. The framework is designed so that the AI waits for human approval rather than automatically advancing. (⁠[DeepWiki](https://deepwiki.com/fabriqaai/specs.md/5.4-agents-and-skills?utm_source=chatgpt.com))

### **Rule 5 — Dummy integrations are real development artifacts**

Do not hard-code fake data directly into the UI.

Use APIs.

### **Rule 6 — The final application must be demonstrable**

A final screenshot is not enough.

You must demonstrate the complete workflow.

# **PART A — BOOTSTRAP**

# **STEP 0 — Create the Project**

## **Goal**

Create an empty Git repository for WeighingMS.

## **Do this**

Open your terminal.

Run:

mkdir weighingms  
cd weighingms  
git init

Verify:

git status

## **You should see**

A Git repository with no committed files yet.

## **Evidence**

Capture:

STEP-00-git.png

Your evidence must show:

- current directory

- git status

- repository initialized

# **STEP 1 — Add the Product Sources**

## **Goal**

Put the two supplied source artifacts into the project.

Create:

mkdir -p docs

Copy the supplied files into:

docs/brief.md  
docs/customize-weighing-station.html

Your project should now look like:

weighingms/  
├── .git/  
└── docs/  
├── brief.md  
└── customize-weighing-station.html

## **Verify**

Run:

ls -la docs

Then:

git status

## **Evidence**

Submit:

STEP-01-files.png

# **STEP 2 — Install specs.md**

## **Goal**

Install the specs.md framework and select the AI-DLC flow.

The current specs.md Quick Start requires Node.js 18+ and an AI coding tool such as Claude Code, Cursor, GitHub Copilot or Google Antigravity. The documented installation command is npx specsmd@latest install. (⁠[GitHub](https://github.com/fabriqaai/specs.md))

## **Verify Node**

Run:

node --version

You need Node.js 18 or higher.

## **Install specs.md**

Run:

npx specsmd@latest install

When asked:

Select a development flow

choose:

AI-DLC - Full methodology with DDD (comprehensive checkpoints)

The installer detects your AI coding tool and installs the corresponding agent definitions and slash commands. (⁠[GitHub](https://github.com/fabriqaai/specs.md))

## **Verify**

Run:

cat .specsmd/manifest.yaml

Then:

ls .specsmd/aidlc/agents/

You should see the AI-DLC agents.

## **Evidence**

Submit:

STEP-02-installation.png  
STEP-02-manifest.txt

# **STEP 2.5 — Add Puku Skill** 

**Puku CLI Compatibility:** specs.md installs its agent definitions for other AI tools, so Puku CLI must be given them as *skills*. The original agent definitions are available at .specsmd/aidlc/agents/

Add master agent

.puku-cli/skills/ specsmd-master-agent/SKILL.md,

like that add all 3 another skill

/specsmd-inception-agent  
/specsmd-construction-agent  
/specsmd-operations-agent

Close puku and again restart it

# **STEP 3 — Verify the AI-DLC Agents**

The four AI-DLC agents are:

/specsmd-master-agent  
/specsmd-inception-agent  
/specsmd-construction-agent  
/specsmd-operations-agent

The official repository documents these as the AI-DLC agent entry points. (⁠[GitHub](https://github.com/fabriqaai/specs.md))

## **Open your AI coding tool**

Use the AI coding tool configured by specs.md.

For this workbook, examples use Claude Code-style slash commands.

## **Run**

/specsmd-master-agent

Then say:

Analyze the current project and explain where I am in the AI-DLC lifecycle.  
  
Do not create or modify any project artifact yet.

## **Evidence**

Capture the response:

STEP-03-master-agent.png

# **STEP 4 — Open the specs.md Dashboard**

Open another terminal.

Run:

npx specsmd@latest dashboard

The dashboard provides a visual view of the flow state. The current documentation also provides dashboard-cli if you prefer a terminal dashboard. (⁠[GitHub](https://github.com/fabriqaai/specs.md))

## **Evidence**

Submit:

STEP-04-dashboard.png

Define the Tech Stack Standard :

Before Inception, have the agent recommend the stack, approve it

# **PART B — INCEPTION**

The Inception phase converts the product idea into a structured development model.

You will create:

Intent  
Requirements  
System Context  
Units  
Stories  
Bolts

The AI-DLC memory-bank structure stores these artifacts under memory-bank/. (⁠[GitHub](https://github.com/fabriqaai/specs.md))

# **STEP 5 — Ask the Master Agent to Explain the Current State**

Run:

/specsmd-master-agent

Enter:

Analyze the current WeighingMS project.  
  
The project contains:  
  
docs/brief.md  
docs/customize-weighing-station.html  
  
Tell me:  
  
1. What source material is available?  
2. What phase of AI-DLC should we be in?  
3. What artifact should be created next?  
4. What information is still unknown?  
  
Do not create the next artifact yet.

## **Expected outcome**

The AI should recognize that:

No Intent  
→ Pre-Inception

The framework determines project state from the artifacts in memory-bank/. (⁠[DeepWiki](https://deepwiki.com/fabriqaai/specs.md/5.4-agents-and-skills?utm_source=chatgpt.com))

## **Evidence**

STEP-05-context-analysis.png

# **STEP 6 — Create the WeighingMS Intent**

## **Goal**

Create the first AI-DLC artifact.

Run:

/specsmd-inception-agent

Then provide:

We are building WeighingMS, an Assisted Dyestuff Weighing Station.  
  
Use these source artifacts:  
  
docs/brief.md  
docs/customize-weighing-station.html  
  
Create the project Intent.  
  
The final product must reproduce the functional experience represented by the supplied UI/UX.

The product must use Dummy APIs for:  
- OrgaTEX  
- weighing scales  
- scanner  
- printer

Do not invent real external API contracts.  
  
Where the Product Brief contains unresolved questions, identify them explicitly.  
  
Do not begin implementation.  
  
Create the Intent and stop at the appropriate human validation checkpoint.

The Inception Agent is responsible for intent capture, requirements elaboration and decomposition. (⁠[DeepWiki](https://deepwiki.com/fabriqaai/specs.md/5.4-agents-and-skills?utm_source=chatgpt.com))

## **Find the generated artifact**

Look inside:

memory-bank/intents/

The project should now have an Intent directory.

## **Evidence**

Submit:

STEP-06-intent.png  
STEP-06-intent-file.png

# **CHECKPOINT 1 — Validate the Intent**

STOP.

Read the generated Intent.

Do not continue until you agree that it represents the product.

Check:

\[ \] Business problem is correct  
\[ \] Primary user is correct  
\[ \] Desired outcome is correct  
\[ \] Scope is reasonable  
\[ \] UI/UX is included as a source  
\[ \] Dummy integrations are included  
\[ \] Unknowns are identified

If something is wrong, tell the agent what must change.

Example:

The Intent is incorrect.  
  
The system is not intended to replace OrgaTEX.  
WeighingMS is the weighing station application and OrgaTEX remains the upstream/downstream production system.  
  
Revise the Intent accordingly.

When satisfied:

APPROVE INTENT

## **Evidence**

STEP-06-GATE-APPROVED.png

# **STEP 7 — Elaborate Requirements**

Run:

/specsmd-inception-agent

Tell it:

Continue from the approved WeighingMS Intent.  
  
Create the detailed Requirements.  
  
Use:  
  
docs/brief.md  
docs/customize-weighing-station.html  
approved Intent  
  
Requirements must cover the complete functional product:  
  
1. Batch queue  
2. Batch selection  
3. Recipe loading  
4. Component identification  
5. Dyestuff lot  
6. Container  
7. Tare  
8. Scale selection  
9. Live weight  
10. Target quantity  
11. Remaining quantity  
12. Tolerance  
13. Confirmation  
14. Overshoot  
15. Component progression  
16. Batch completion  
17. OrgaTEX write-back  
18. Ticket generation  
19. Operator traceability  
20. Scale/scanner/printer failure  
  
Separate:  
- confirmed requirements  
- assumptions  
- unresolved questions  
- training-only dummy behaviour.  
  
Do not invent real OrgaTEX contracts.  
  
Create the requirements artifact and stop at the human validation checkpoint.

The current AI-DLC flow describes Inception as the stage where requirements are elaborated before decomposition. (⁠[GitHub](https://github.com/fabriqaai/specs.md))

## **Evidence**

STEP-07-requirements.png

# **CHECKPOINT 2 — Validate Requirements**

Read the requirements.

For each requirement ask:

Can I understand what the system must do?  
Can I test it?  
Can I trace it to the Product Brief or UI?

If not, ask the agent to revise it.

When satisfied:

APPROVE REQUIREMENTS

## **Evidence**

STEP-07-GATE-APPROVED.png

# **STEP 8 — Convert the UI/UX Into Development Knowledge**

The supplied HTML is not just a picture.

It contains:

- screens

- components

- states

- data

- interaction logic

- simulation behaviour

- business assumptions

The prototype itself contains three major views:

1 · Select batch  
2 · Weigh  
3 · Confirm & print

and the weighing behaviour includes tolerance states, scale switching, component progression and overshoot behaviour.

## **Give the agent the UI analysis task**

Run: /specsmd-inception-agent

Enter:

Analyze docs/customize-weighing-station.html as a functional prototype.  
  
Do not redesign it.  
  
Extract the information required to build the product:  
  
1. Screen inventory  
2. UI components  
3. User actions  
4. Application states  
5. Data displayed  
6. Data required  
7. State transitions  
8. Validation behaviour  
9. Integration points  
10. Business rules embedded in JavaScript  
11. Assumptions represented by the prototype  
12. Questions that the prototype cannot answer  
  
Map each finding back to the supplied prototype where possible.  
Do not implement code.

## **Evidence**

Create a submission containing:

STEP-08-ui-analysis/  
├── screen-inventory.png  
├── component-inventory.png  
├── state-model.png  
└── ai-analysis.png

# **STEP 9 — Create System Context**

Run:

/specsmd-inception-agent

Tell it:

Using the approved WeighingMS Intent and Requirements, create the System Context.  
  
Include:  
  
Human actors:  
- Operator  
- Supervisor  
  
Systems:  
- WeighingMS  
- OrgaTEX  
  
Devices:  
- Scale  
- Scanner  
- Printer  
  
Training substitutes:  
- Dummy OrgaTEX API  
- Dummy Scale API  
- Dummy Scanner  
- Dummy Printer  
  
Show:  
- inbound data  
- outbound data  
- ownership  
- integration boundaries  
- failure boundaries  
  
Clearly distinguish the real conceptual systems from their training-time dummy implementations.

## **Evidence**

Submit:

STEP-09-system-context.png  
STEP-09-system-context.md

# **STEP 10 — Decompose the Product Into Units**

Now we move from requirements to independently developable capabilities.

Run:

/specsmd-inception-agent

Enter:

Using the approved Intent, Requirements and System Context:  
  
Decompose WeighingMS into coherent independently developable Units.  
  
Do not create Units simply because there are three screens.  
  
Evaluate capabilities such as:  
  
- Batch Management  
- Recipe & Material Management  
- Weighing Station  
- Scale Integration  
- OrgaTEX Integration  
- Ticket & Printing  
  
Determine the final Units from the requirements and dependencies.  
  
For every Unit explain:  
- responsibility  
- included capabilities  
- dependencies  
- why it should be a separate Unit  
- proposed construction bolt type

The specs.md Inception flow uses Units as a decomposition layer before Stories and Bolts. (⁠[DeepWiki](https://deepwiki.com/fabriqaai/specs.md/5.4-agents-and-skills?utm_source=chatgpt.com))

## **Evidence**

Submit:

STEP-10-units.png  
STEP-10-unit-map.png

# **CHECKPOINT 3 — Validate Units**

Ask:

\[ \] Does every requirement belong to a Unit?  
\[ \] Are Units capability-oriented?  
\[ \] Are dependencies understandable?  
\[ \] Is the Weighing Station treated as more than a screen?  
\[ \] Are integrations separated appropriately?

Approve:

APPROVE UNITS

# **STEP 11 — Create Stories**

Run:

/specsmd-inception-agent

Tell it:

Create the Stories for the approved WeighingMS Units.  
  
Every Story must:  
  
- provide observable user/system value  
- reference its Unit  
- reference relevant requirements  
- include acceptance criteria  
- identify UI/UX impact  
- identify API dependencies  
- identify test expectations  
  
Stories must collectively deliver the complete supplied WeighingMS UI/UX.  
  
Do not create implementation tasks yet.

## **Evidence**

Submit:

STEP-11-stories.png

# **STEP 12 — Create the Bolt Plan**

Run:

/specsmd-inception-agent

Enter:

Create the complete Bolt Plan for WeighingMS.  
  
Group the approved Stories into executable Bolts.  
  
Respect dependencies.  
  
Use Simple Construction Bolts for appropriate UI/integration/utility work.  
  
Use DDD Construction Bolts where domain-heavy backend work requires the richer stages.  
  
Ensure the final Bolt sequence can produce the complete working application.  
  
For every Bolt provide:  
- Bolt ID  
- Unit  
- Stories  
- dependencies  
- Bolt type  
- expected outcome  
- test expectations

The specs.md documentation distinguishes Simple Construction Bolts for UI/integrations/utilities from DDD Construction Bolts for more domain-heavy work. (⁠[DeepWiki](https://deepwiki.com/fabriqaai/specs.md/5.4-agents-and-skills?utm_source=chatgpt.com))

## **Evidence**

Submit:

STEP-12-bolt-plan.png

# **CHECKPOINT 4 — INCEPTION COMPLETE**

At this point you should have:

memory-bank/  
└── intents/  
└── \<your-intent\>/  
├── requirements.md  
├── system-context.md  
└── units/

and:

memory-bank/bolts/

with the planned construction work.

The current AI-DLC structure uses memory-bank/standards, memory-bank/intents, memory-bank/bolts and memory-bank/operations. (⁠[GitHub](https://github.com/fabriqaai/specs.md))

## **Final Inception checklist**

\[ \] Intent approved  
\[ \] Requirements approved  
\[ \] UI/UX analyzed  
\[ \] System context approved  
\[ \] Units approved  
\[ \] Stories approved  
\[ \] Bolt plan approved

Capture:

STEP-12-INCEPTION-COMPLETE.png

# **PART C — CONSTRUCTION**

Now we build.

Construction is not:

"AI, build the app."

Construction is:

Select Bolt  
→ Plan  
→ Human Review  
→ Implement  
→ Test  
→ Human Review  
→ Complete

AI-DLC Construction uses defined Bolt stages, and the framework’s agents enforce human validation checkpoints. (⁠[DeepWiki](https://deepwiki.com/fabriqaai/specs.md/5.4-agents-and-skills?utm_source=chatgpt.com))

# **STEP 13 — List the Bolts**

Run:

/specsmd-construction-agent

Ask:

List all WeighingMS Bolts.  
  
Show:  
- Bolt ID  
- Unit  
- Description  
- Bolt type  
- dependencies  
- status  
- next executable Bolt

The Construction Agent provides Bolt listing and Bolt execution/status capabilities. (⁠[DeepWiki](https://deepwiki.com/fabriqaai/specs.md/5.4-agents-and-skills?utm_source=chatgpt.com))

## **Evidence**

STEP-13-bolt-list.png

# **STEP 14 — Start the First Bolt**

Select the first executable Bolt from the generated plan.

Run:

/specsmd-construction-agent --unit="\<EXACT UNIT NAME\>" --bolt-id="\<EXACT BOLT ID\>"

**Do not replace the Unit name with a generic placeholder.**

Copy the exact Unit name generated by your project.

## **Evidence**

STEP-14-bolt-start.png

# **STEP 15 — Execute the Bolt Plan Stage**

If this is a Simple Construction Bolt, the expected stages are:

Plan  
→ Implement  
→ Test

For DDD Construction Bolts, the framework uses:

Model  
→ Design  
→ ADR  
→ Implement  
→ Test

The current specs.md documentation identifies these two Bolt stage models. (⁠[DeepWiki](https://deepwiki.com/fabriqaai/specs.md/5.4-agents-and-skills?utm_source=chatgpt.com))

### **Your instruction to the agent**

Execute the current Bolt.  
  
Start with the current Bolt's required planning stage.  
  
Do not implement yet.  
  
Explain:  
1. What will change?  
2. Which files will be created/modified?  
3. Which requirements and stories are being implemented?  
4. Which APIs are involved?  
5. How will this be tested?  
  
Stop at the human validation checkpoint.

## **Evidence**

STEP-15-plan.png

# **CHECKPOINT 5 — Approve the Bolt Plan**

Review the proposed implementation.

Ask:

Does this plan implement the Story?  
Does it respect the existing architecture?  
Does it use the agreed APIs?  
Does it preserve the UI/UX?  
Can I test it?

If yes:

APPROVE PLAN

The Bolt Plan is approved.

Proceed to the Implement stage for the current Bolt.

Stop at the next human validation checkpoint.

# **STEP 16 — Build the Dummy Integration Layer**

This is the first major construction target.

## **Goal**

Create working APIs for the external dependencies.

You need:

Dummy OrgaTEX  
Dummy Scale  
Dummy Scanner  
Dummy Printer

The UI must eventually consume these services rather than embedding scenario data directly in components.

## **Dummy OrgaTEX API**

The training application needs at least:

GET /api/batches  
GET /api/batches/:batchId  
GET /api/batches/:batchId/recipe  
POST /api/batches/:batchId/consumption

## **Dummy Scale API**

At minimum:

GET /api/scales  
GET /api/scales/:scaleId/status  
GET /api/scales/:scaleId/weight  
POST /api/scales/:scaleId/tare

## **Dummy Printer API**

At minimum:

POST /api/tickets

## **Important**

These are **training contracts**, not claims about the real OrgaTEX interface.

The Product Brief’s unresolved integration questions remain unresolved.

# **STEP 17 — Seed the Dummy Data**

The supplied prototype gives us the training scenario.

Use:

Batch  
B-24187  
  
Order  
SO-9931  
  
Machine  
JET-04  
  
Shade  
Teal 4C

The supplied prototype contains five components:

Remazol Brill. Blue RSPL  
Remazol Red RB  
Remazol Yellow RGB  
Sodium Sulphate  
Soda Ash

It also defines different units and scales for these components.

## **Evidence**

Submit:

STEP-17-dummy-data.json  
STEP-17-api-response.png

# **STEP 18 — Test the Dummy APIs**

Before connecting the UI, test each API.

For example:

curl [http://localhost:\<PORT\>/api/batches](http://localhost:<PORT>/api/batches)

Then:

curl [http://localhost:\<PORT\>/api/batches/B-24187](http://localhost:<PORT>/api/batches/B-24187)

Then:

curl [http://localhost:\<PORT\>/api/batches/B-24187/recipe](http://localhost:<PORT>/api/batches/B-24187/recipe)

Use the actual port produced by your implementation.

## **Evidence**

Submit:

STEP-18-api-tests.txt  
STEP-18-api-results.png

# **STEP 19 — Connect Batch Selection**

The first UI screen is:

1 · Select batch

The supplied UI displays a batch queue including:

B-24187  
B-24188  
B-24190  
B-24191

## **Requirement**

The screen must obtain its data from:

GET /api/batches

When the user selects B-24187:

GET /api/batches/B-24187

Then:

GET /api/batches/B-24187/recipe

## **Do not**

Hard-code:

const batches = \[...\]

inside the UI.

## **Evidence**

Submit:

STEP-19-batch-screen.png  
STEP-19-network.png  
STEP-19-test.png

# **STEP 20 — Implement the Weighing Screen**

Now reproduce:

2 · Weigh

The supplied UI contains:

Component  
Code  
Lot  
Container  
Tare  
  
Scale Selected  
  
Weighed Now  
Still To Weigh  
Target  
  
Progress  
  
Tolerance  
  
Status  
  
OK  
Re-tare  
Quit  
Supervisor Override

## **Build it using the specification**

Do not copy the original JavaScript implementation.

Use your approved requirements and architecture.

## **Evidence**

Capture:

STEP-20-weigh-screen.png

# **STEP 21 — Connect the Scale API**

The UI must now obtain the current weight from the Dummy Scale API.

Example:

GET /api/scales/scale-3kg/weight

The exact API structure should be whatever was approved in your API contract.

## **Demonstrate**

Yellow RGB  
→ 3 kg precision  
  
Sodium Sulphate  
→ 32 kg floor

The supplied prototype explicitly switches between these scale configurations.

## **Evidence**

STEP-21-scale-switch.png  
STEP-21-scale-api.png

# **STEP 22 — Implement Tolerance**

For Yellow RGB the supplied scenario uses:

Target = 94.0 g  
Tolerance = ±0.5 g

The UI therefore has:

93.5 g → 94.5 g

as the tolerance range.

## **Your application must demonstrate**

### **Below tolerance**

93.4 g  
→ cannot confirm

### **Boundary**

93.5 g  
→ can confirm

### **Target**

94.0 g  
→ can confirm

### **Upper boundary**

94.5 g  
→ can confirm

### **Over**

94.6 g  
→ cannot confirm

## **Evidence**

Submit automated tests.

STEP-22-tolerance-tests.txt  
STEP-22-tolerance-ui.png

# **STEP 23 — Implement Component Progression**

The completed components must progress:

Blue RSPL  
↓  
Red RB  
↓  
Yellow RGB  
↓  
Sodium Sulphate  
↓  
Soda Ash

The supplied UI represents this as a five-component recipe.

## **Requirements**

A component cannot be marked complete unless its weight is valid.

The batch cannot complete until all components are complete.

## **Evidence**

Create a continuous screen recording:

STEP-23-five-component-demo.mp4

# **STEP 24 — Implement Overshoot**

The supplied prototype deliberately represents overshoot as a business question.

Do not simply copy its proposed calculation.

Instead, create a decision:

Observed problem  
↓  
Business rule  
↓  
Implementation  
↓  
Test

## **Ask the AI**

Review the approved WeighingMS requirements and the supplied prototype's overshoot behaviour.  
  
Identify exactly what is known and what is assumed.  
  
Propose two or three safe training implementations for surplus handling.  
  
Do not silently choose one.  
  
Explain the impact of each option.  
  
Stop for human decision.

## **You decide**

Record your selected training rule.

Example:

For this training implementation, an overweight component remains  
unconfirmed and the operator must use the defined recovery action.  
No automatic recipe recalculation will be performed unless explicitly  
specified by the approved business rule.

Use whatever rule the team actually approves.

## **Evidence**

STEP-24-overshoot-decision.md  
STEP-24-overshoot-test.png  
STEP-24-overshoot-ui.png

# **STEP 25 — Implement Confirmation**

The supplied UI only enables confirmation when the weight is within tolerance.

Implement:

Weight  
↓  
Tolerance Evaluation  
↓  
Valid?  
├── NO → Confirm disabled  
└── YES → Confirm enabled

When confirmed:

actualWeight  
operator  
component  
lot  
container  
tare  
scale  
timestamp

must be recorded.

## **Evidence**

STEP-25-confirmation.png  
STEP-25-transaction.json

# **STEP 26 — Implement OrgaTEX Write-back**

When the final component is complete:

5/5  
↓  
Complete Batch  
↓  
POST /api/batches/B-24187/consumption  
↓  
Dummy OrgaTEX

The supplied Product Brief calls for actual consumption to be posted back to the production system.

## **Demonstrate**

### **UI**

Written to OrgaTEX  
CONFIRMED

### **API**

POST /api/batches/B-24187/consumption

### **Response**

200 OK

### **Stored data**

Show the resulting consumption record.

## **Evidence**

STEP-26-ui.png  
STEP-26-request.png  
STEP-26-response.png  
STEP-26-data.png

# **STEP 27 — Implement Ticket Generation**

The supplied UI’s final screen is:

3 · Confirm & print

The prototype ticket contains:

Batch  
Order  
Machine  
Shade  
Date  
Operator  
Components  
Target  
Actual  
Barcode

## **Build**

Batch Complete  
↓  
Generate Ticket  
↓  
Dummy Printer  
↓  
Print / Print Preview

## **Evidence**

Submit:

STEP-27-ticket.png  
STEP-27-printer-api.png  
STEP-27-ticket-test.png

# **STEP 28 — Complete the UI/UX Validation**

Now compare the working application against the supplied prototype.

Open both:

Original:  
docs/customize-weighing-station.html  
  
Your implementation:  
[http://localhost:\<PORT](http://localhost:<PORT)\>

Compare:

Screen 1  
Screen 2  
Screen 3

Then compare:

States  
Interactions  
Data  
Labels  
Units  
Tolerance  
Scale switching  
Component progression  
Completion  
Ticket

## **Evidence**

Create:

STEP-28-ui-validation/  
├── screen-1-comparison.png  
├── screen-2-comparison.png  
├── screen-3-comparison.png  
└── validation.md

# **STEP 29 — Run the Complete End-to-End Test**

The final scenario is:

Open WeighingMS  
↓  
Select B-24187  
↓  
Load Recipe  
↓  
Blue RSPL  
↓  
Confirm  
↓  
Red RB  
↓  
Confirm  
↓  
Yellow RGB  
↓  
Confirm  
↓  
Sodium Sulphate  
↓  
Confirm  
↓  
Soda Ash  
↓  
Confirm  
↓  
Batch Complete  
↓  
OrgaTEX Write-back  
↓  
Ticket

## **Test it with Playwright**

The exact test command depends on the test setup created during construction.

Run the project’s approved test command.

Then run the Playwright suite.

## **Evidence**

Submit:

STEP-29-playwright-report/

and:

STEP-29-e2e-video.mp4

# **STEP 30 — Test Failure Scenarios**

A functional industrial application cannot only demonstrate success.

Test:

Scale unavailable  
OrgaTEX unavailable  
Printer unavailable  
Invalid weight  
Over tolerance  
Under tolerance  
Re-tare  
Quit  
Incomplete batch

## **Evidence**

Create:

STEP-30-failure-tests.md

with:

| **Scenario**        | **Expected**      | **Actual** | **Pass** |
|---------------------|-------------------|------------|----------|
| Scale unavailable   | Safe failure      |            |          |
| OrgaTEX unavailable | Defined behaviour |            |          |
| Printer unavailable | Defined behaviour |            |          |
| Over tolerance      | Cannot confirm    |            |          |
| Under tolerance     | Cannot confirm    |            |          |
| Re-tare             | Weight reset      |            |          |
| Quit                | Safe exit         |            |          |
| Incomplete batch    | Cannot complete   |            |          |

#  **STEP 31 — Check the AI-DLC Project State**

Run:

/specsmd-master-agent

Ask:

Analyze the current WeighingMS AI-DLC project state.  
  
Report:  
  
1. Intent status  
2. Requirements status  
3. Unit status  
4. Story status  
5. Bolt status  
6. Outstanding work  
7. Any status inconsistencies  
8. Whether the project is ready for final validation  
  
Do not modify anything.

The analyze-context capability uses the artifact hierarchy to determine the project phase and checks status integrity across Intent → Units → Stories → Bolts. (⁠[DeepWiki](https://deepwiki.com/fabriqaai/specs.md/5.4-agents-and-skills?utm_source=chatgpt.com))

## **Evidence**

STEP-31-project-status.png

# **STEP 32 — Open the Final Dashboard**

Run:

npx specsmd@latest dashboard

Review:

Intent  
Requirements  
Units  
Bolts  
Progress  
Git changes

## **Evidence**

STEP-32-final-dashboard.png

# **STEP 33 — Final Human Validation**

This is the final gate.

Do not ask:

“Did the AI finish?”

Ask:

“Did we build the product we intended to build?”

## **Validate against five sources**

### **1. Product Brief**

Does the product solve the defined problem?

### **2. UI/UX**

Does the working application reproduce the intended experience?

### **3. Requirements**

Does every approved requirement have an implementation?

### **4. Acceptance Criteria**

Can every important behaviour be demonstrated?

### **5. Tests**

Can the behaviour be proven automatically?

# **STEP 34 — Create the Final Evidence Matrix**

Create:

FINAL-EVIDENCE.md

Use:

| **Requirement**       | **UI** | **API** | **Code** | **Test** | **Evidence** | **Result** |
|-----------------------|--------|---------|----------|----------|--------------|------------|
| Batch queue           | ✓      | ✓       | ✓        | ✓        |              |            |
| Batch selection       | ✓      | ✓       | ✓        | ✓        |              |            |
| Recipe                | ✓      | ✓       | ✓        | ✓        |              |            |
| Scale selection       | ✓      | ✓       | ✓        | ✓        |              |            |
| Live weight           | ✓      | ✓       | ✓        | ✓        |              |            |
| Tolerance             | ✓      | —       | ✓        | ✓        |              |            |
| Lot tracking          | ✓      | ✓       | ✓        | ✓        |              |            |
| Container/tare        | ✓      | ✓       | ✓        | ✓        |              |            |
| Component progression | ✓      | ✓       | ✓        | ✓        |              |            |
| Overshoot             | ✓      | ✓       | ✓        | ✓        |              |            |
| OrgaTEX write-back    | ✓      | ✓       | ✓        | ✓        |              |            |
| Ticket                | ✓      | ✓       | ✓        | ✓        |              |            |

# **STEP 35 — Final Demonstration**

You now have to demonstrate the actual product.

Do not use slides as the primary demonstration.

Open the running application.

## **Demonstrate**

### **Part 1 — Batch**

Show batch queue.  
Select B-24187.

### **Part 2 — Recipe**

Show five components.

### **Part 3 — Scale**

Show 3 kg scale.  
Complete Yellow RGB.  
Select Sodium Sulphate.  
Show 32 kg scale.

### **Part 4 — Tolerance**

Show an invalid weight.  
Show confirmation blocked.  
  
Reach tolerance.  
Show confirmation enabled.

### **Part 5 — Complete**

Complete all five components.

### **Part 6 — Integration**

Show OrgaTEX API request.  
Show successful response.  
Show stored transaction.

### **Part 7 — Ticket**

Generate ticket.  
Show printed/preview output.

### **Part 8 — Automated Test**

Show Playwright result.

# **FINAL SUBMISSION**

Your repository should contain something similar to:

weighingms/  
│  
├── .git/  
├── .specsmd/  
│  
├── docs/  
│ ├── brief.md  
│ └── customize-weighing-station.html  
│  
├── memory-bank/  
│ ├── standards/  
│ ├── intents/  
│ │ └── \<intent-name\>/  
│ │ ├── requirements.md  
│ │ ├── system-context.md  
│ │ └── units/  
│ ├── bolts/  
│ └── operations/  
│  
├── src/  
│  
├── tests/  
│  
├── playwright/  
│  
├── README.md  
│  
└── FINAL-EVIDENCE.md

# **FINAL EVIDENCE PACKAGE**

Submit:

01-project-bootstrap  
02-specsmd-installation  
03-context-analysis  
04-dashboard  
05-intent  
06-intent-validation  
07-requirements  
08-ui-analysis  
09-system-context  
10-units  
11-stories  
12-bolt-plan  
13-inception-complete  
14-bolt-execution  
15-dummy-apis  
16-dummy-data  
17-api-tests  
18-batch-selection  
19-weighing  
20-scale-integration  
21-tolerance  
22-component-progression  
23-overshoot  
24-confirmation  
25-orgatex-writeback  
26-ticket  
27-ui-validation  
28-e2e  
29-failure-tests  
30-final-project-status  
31-final-dashboard  
32-final-validation  
33-final-evidence  
34-final-demo

# **THE FINISHED PRODUCT**

At the end, your application must be capable of demonstrating:

WEIGHINGMS  
│  
▼  
┌──────────────┐  
│ Batch Queue │  
└──────┬───────┘  
│  
▼  
┌──────────────┐  
│ Select Batch │  
└──────┬───────┘  
│  
▼  
┌──────────────┐  
│ Load Recipe │  
└──────┬───────┘  
│  
▼  
┌──────────────────┐  
│ Select Component │  
└────────┬─────────┘  
│  
▼  
┌──────────────┐  
│ Select Scale │  
└──────┬───────┘  
│  
▼  
┌──────────────┐  
│ Read Weight │  
└──────┬───────┘  
│  
▼  
┌────────────────────┐  
│ Target / Tolerance│  
└─────────┬──────────┘  
│  
┌──────┴───────┐  
│ │  
INVALID VALID  
│ │  
▼ ▼  
Continue Confirm  
│  
▼  
Record Actual  
│  
▼  
Next Component  
│  
▼  
All Done?  
│  
▼  
OrgaTEX Write-back  
│  
▼  
Print Ticket

# **What You Have Actually Learned**

You have not simply built a React/web application.

You have experienced an AI-native development lifecycle:

SOURCE MATERIAL  
↓  
AI ANALYSIS  
↓  
INTENT  
↓  
HUMAN VALIDATION  
↓  
REQUIREMENTS  
↓  
HUMAN VALIDATION  
↓  
SYSTEM CONTEXT  
↓  
UNITS  
↓  
STORIES  
↓  
BOLT PLAN  
↓  
HUMAN VALIDATION  
↓  
CONSTRUCTION  
↓  
AI IMPLEMENTATION  
↓  
HUMAN VALIDATION  
↓  
TEST  
↓  
INTEGRATION  
↓  
END-TO-END VALIDATION  
↓  
WORKING PRODUCT

That is the point of the exercise.

The participant should finish with **both**:

A working WeighingMS

and:

A traceable AI-DLC evidence trail explaining  
why and how that product was built.

The current specs.md architecture is explicitly designed around file-based artifacts, persistent context, specialized agents and human checkpoints rather than one-shot AI code generation. (⁠[DeepWiki](https://deepwiki.com/fabriqaai/specs.md/5.4-agents-and-skills?utm_source=chatgpt.com))

# **One Final Rule for the Participant**

**Never ask the AI to “build the whole application.”**

Instead:

**Ask the AI to execute the next approved Bolt.**

That single discipline is what turns this from an AI coding demo into an **AI-DLC hands-on lab using specs.md**.

The workbook above is now deliberately **execution-first**: the participant starts with the supplied brief.md and HTML, installs specsmd, enters the AI-DLC flow, creates and approves the artifacts, executes the generated Bolts, builds the Dummy APIs, and ends with the functional UI/UX plus evidence.

I also verified the current specs.md repository rather than relying on the earlier DeepWiki interpretation: the current Quick Start specifies npx specsmd@latest install, AI-DLC selection, memory-bank/ artifacts, and the four AI-DLC agents; it also explicitly documents that AI-DLC has comprehensive checkpoints.
