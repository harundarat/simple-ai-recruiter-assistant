# AI-Powered Recruitment Assistant

A backend service that automates the initial screening of job applications using AI. The service evaluates candidate CVs and project reports against job descriptions and case study requirements, producing structured, AI-generated evaluation reports.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the Application](#running-the-application)
- [Data Ingestion](#data-ingestion)
- [API Documentation](#api-documentation)
- [How It Works](#how-it-works)
- [Design Decisions & Trade-offs](#design-decisions--trade-offs)
- [Testing](#testing)
- [Future Improvements](#future-improvements)

---

## Overview

This system automates candidate evaluation through a sophisticated AI pipeline that:

1. **Accepts candidate submissions** - CV and Project Report (PDF files)
2. **Evaluates against ground truth** - Job descriptions, case study requirements, and scoring rubrics stored in a vector database
3. **Generates comprehensive reports** - Using LLM chaining to produce structured evaluation results

### Key Features

- **RESTful API** with three core endpoints: upload, evaluate, and result retrieval
- **Asynchronous Processing** using BullMQ job queue for long-running AI evaluations
- **RAG (Retrieval-Augmented Generation)** with ChromaDB vector database for semantic search
- **Multi-stage LLM Pipeline** with strategic model selection for cost efficiency
- **Robust Error Handling** with bounded retries, smart error classification, and per-service circuit breakers
- **PDF Processing** with multimodal AI for direct document analysis

---

## Architecture

### System Flow

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │
       │ POST /upload (CV + Project Report PDFs)
       ▼
┌─────────────────┐         ┌──────────┐
│  Upload Service │────────▶│ AWS S3   │
└────────┬────────┘         └──────────┘
         │
         │ Returns: cv_id, project_report_id
         │
         │ POST /evaluate (job_title, cv_id, project_report_id)
         ▼
┌──────────────────┐        ┌─────────────┐
│ Evaluate Service │───────▶│ PostgreSQL  │
└────────┬─────────┘        └─────────────┘
         │                          │
         │ Creates job              │ Stores evaluation record
         ▼                          │ Status: queued
┌──────────────────┐                │
│   BullMQ Queue   │◀───────────────┘
└────────┬─────────┘
         │
         │ Background Worker processes job
         ▼
┌──────────────────────────────────────────┐
│      Evaluation Processor                │
│  1. Update status to 'processing'        │
│  2. Fetch files from S3                  │
│  3. Retrieve ground truth from ChromaDB  │
│  4. Execute 3-stage LLM pipeline:        │
│     • CV Evaluation (Gemini Flash Lite) │
│     • Project Evaluation (Flash Lite)   │
│     • Final Synthesis (Gemini Flash)    │
│  5. Checkpoint each document evaluation  │
│  6. Update status to 'completed'         │
└──────────────────────────────────────────┘
         │
         │ GET /result/:id
         ▼
┌──────────────────┐
│   Client gets    │
│ evaluation result│
└──────────────────┘
```

### 3-Stage LLM Pipeline

```
Stage 1: CV Evaluation
├─ Input: CV PDF + Job Description + CV Rubric (from RAG)
├─ Model: Gemini Flash Lite (multimodal PDF support)
├─ Output: cv_match_rate, cv_feedback, detailed scores
└─ Reasoning: Fast, cost-effective, good for structured analysis

Stage 2: Project Report Evaluation
├─ Input: Project PDF + Case Study Brief + Project Rubric (from RAG)
├─ Model: Gemini Flash Lite (multimodal PDF support)
├─ Output: project_score, project_feedback, detailed scores
└─ Reasoning: Consistent with CV evaluation, handles PDF well

Checkpoint
├─ Each validated Stage 1/2 payload is saved independently in PostgreSQL
└─ BullMQ retries reuse valid checkpoints and only rerun missing stages

Stage 3: Final Synthesis
├─ Input: Results from Stage 1 + Stage 2
├─ Model: Gemini Flash (stronger reasoning capabilities)
├─ Output: overall_summary
└─ Reasoning: Better at synthesis and summarization
```

---

## Tech Stack

### Backend Framework

- **NestJS 11** - Progressive Node.js framework
- **TypeScript 7** - Native compiler for fast type checking (TypeScript 6 API compatibility is retained for Jest/ESLint tooling)

### Database & Storage

- **PostgreSQL** - Primary database for structured data
- **Prisma ORM 7** - Type-safe database access using the PostgreSQL driver adapter
- **AWS S3** - Object storage for CV and Project Report PDFs
- **ChromaDB** - Vector database for semantic search (RAG)

### AI & LLM

- **Google Gemini API** - Large language models
  - `gemini-2.5-flash-lite` - CV & Project evaluation (cost-efficient, multimodal)
  - `gemini-2.5-flash` - Final synthesis (better reasoning)
- **Google Gemini Embeddings** - Text embeddings for vector search

### Job Queue & Processing

- **BullMQ** - Robust job queue for async processing
- **Redis** - In-memory data store for BullMQ

### File Upload

- **Multer** - Multipart/form-data handling
- **multer-s3** - Direct upload to AWS S3

---

## Project Structure

```
simple-ai-recruiter-assistant/
├── prisma/
│   ├── schema.prisma              # Database schema
│   └── migrations/                # Database migrations
├── seed/
│   ├── seeder-pdf.ts             # Vector DB ingestion script
│   ├── test-chromadb.ts          # Vector DB verification script
│   ├── README.md                 # Detailed seeder documentation
│   └── backend_case_study_clean.pdf  # Source document for ingestion
├── src/
│   ├── upload/
│   │   ├── upload.controller.ts  # POST /upload endpoint
│   │   ├── upload.service.ts     # S3 upload & DB storage logic
│   │   ├── upload.module.ts
│   │   ├── validators/
│   │   │   └── file-validation.pipe.ts  # Dual-layer file validation
│   │   └── constants/
│   │       └── file-validation.constants.ts  # Validation rules & messages
│   ├── evaluate/
│   │   ├── evaluate.controller.ts    # POST /evaluate, GET /result/:id
│   │   ├── evaluate.service.ts       # Core evaluation logic
│   │   ├── evaluate.processor.ts     # BullMQ worker
│   │   ├── evaluate.module.ts
│   │   ├── dto/
│   │   │   ├── evaluate-request.dto.ts
│   │   │   ├── cv-evaluation-result.dto.ts
│   │   │   └── project-evaluation-result.dto.ts
│   │   └── prompt/
│   │       ├── cv-evaluation.prompt.ts           # CV evaluation system prompt
│   │       ├── project-report-evaluation.prompt.ts
│   │       └── final-synthesis.prompt.ts
│   ├── shared/
│   │   ├── prisma.service.ts     # Prisma client singleton
│   │   ├── s3.service.ts         # AWS S3 / MinIO operations
│   │   ├── gemini-client.ts      # Injectable production Gemini adapter
│   │   ├── llm.service.ts        # Operation-specific Gemini calls
│   │   ├── chroma.service.ts     # ChromaDB vector search
│   │   ├── circuit-breaker.executor.ts # Per-service circuit breaker registry
│   │   ├── retry.executor.ts     # Injectable bounded retry executor
│   │   ├── pipeline-error.ts     # Structured pipeline error mapping
│   │   ├── retry.utils.ts        # Retry utility functions
│   │   └── shared.module.ts
│   ├── app.module.ts
│   └── main.ts
├── docs/
│   └── Case Study Brief.pdf      # Original case study requirements
├── .env                          # Environment variables (not in repo)
├── package.json
└── README.md                     # This file
```

---

## Prerequisites

Before running this application, ensure you have:

1. **Node.js 24 or higher**
2. **pnpm 11** package manager
3. **Docker with Docker Compose** (for PostgreSQL, Redis, and ChromaDB)
4. **AWS Account** with S3 bucket configured (production only; local/E2E uses MinIO)
5. **Google Gemini API Key**

---

## Installation

### 1. Clone the repository

```bash
git clone <repository-url>
cd simple-ai-recruiter-assistant
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Start local services

The Compose stack starts PostgreSQL 18, Redis 8, ChromaDB 1.5, and a pinned development-only MinIO server. It also creates `S3_BUCKET_NAME` idempotently. All published ports bind to localhost.

```bash
docker compose up -d
docker compose ps
```

---

## Configuration

### 1. Create `.env` file

Create a `.env` file in the project root with the following variables:

```env
# Database (matches docker-compose.yml defaults)
DATABASE_URL="postgresql://evalu8:evalu8@localhost:5432/evalu8?schema=public"

# Redis (for BullMQ)
REDIS_HOST="localhost"
REDIS_PORT="6379"

# AWS S3
S3_REGION="ap-southeast-1"
S3_ACCESS_KEY_ID="your-aws-access-key"
S3_SECRET_ACCESS_KEY="your-aws-secret-key"
S3_BUCKET_NAME="your-bucket-name"

# Google Gemini API
GOOGLE_GEMINI_API_KEY="your-gemini-api-key"

# ChromaDB
CHROMA_HOST="localhost"
CHROMA_PORT="8000"
CHROMA_COLLECTION_NAME="ground_truth"

# Optional S3-compatible local endpoint. Leave unset in production to use AWS.
S3_ENDPOINT="http://localhost:9000"
S3_FORCE_PATH_STYLE="true"

# Application
PORT="3000"
NODE_ENV="development"

# External service circuit breakers
CIRCUIT_BREAKER_ENABLED="true"
CIRCUIT_BREAKER_FAILURE_THRESHOLD="3"
CIRCUIT_BREAKER_RESET_TIMEOUT_MS="30000"
```

Circuit breaker settings are read at startup. `CIRCUIT_BREAKER_ENABLED=false`
bypasses circuit state while retaining the existing retry and timeout behavior.
The failure threshold and reset timeout must be positive integers.

### 2. Run database migrations

```bash
pnpm exec prisma migrate deploy
```

### 3. Generate Prisma client

```bash
pnpm run db:generate
```

---

## Running the Application

### Development mode (with hot reload)

```bash
pnpm run start:dev
```

### Production mode

```bash
# Build
pnpm run build

# Run
pnpm run start:prod
```

The server will start at `http://localhost:3000`

---

## Data Ingestion

Before running evaluations, you need to populate ChromaDB with ground truth documents (job descriptions, case study briefs, scoring rubrics).

### 1. Prepare the source PDF

Ensure you have a clean, well-structured PDF in the `seed/` directory. The default is `backend_case_study_clean.pdf`.

**PDF Requirements:**

- Clear section headings (Job Description, Case Study Brief, CV Rubric, Project Rubric)
- 4-6 pages maximum
- File size under 50KB recommended
- Simple formatting without complex nested structures

### 2. Run the ingestion script

```bash
# Make sure ChromaDB is running first

# Option 1: Using npm script (recommended)
pnpm run seed:pdf -- --file=backend_case_study_clean.pdf --role=backend

# Option 2: Using npx directly
npx ts-node seed/seeder-pdf.ts --file=backend_case_study_clean.pdf --role=backend

# For different roles (frontend, fullstack, etc.)
pnpm run seed:pdf -- --file=frontend_case_study.pdf --role=frontend
```

**CLI Arguments:**

- `--file` or `-f`: PDF filename in the `seed/` directory (required)
- `--role` or `-r`: Role for metadata (backend, frontend, fullstack, etc.) (required)

**What this does:**

- Reads the specified PDF using Gemini multimodal AI
- Extracts 4 distinct sections:
  1. Job Description
  2. Case Study Brief
  3. CV Scoring Rubric
  4. Project Scoring Rubric
- Validates each section (character count checks)
- Auto-generates document IDs from filename and role
- Generates embeddings using Google Gemini
- Stores documents in ChromaDB with metadata for filtering

### 3. Verify the ingestion

```bash
pnpm ts-node seed/test-chromadb.ts
```

This will query ChromaDB and display the ingested documents.

**Expected output:**

```
✅ Successfully connected to collection: ground_truth
✅ Seeding complete! Collection 'ground_truth' now has 4 documents.

📊 Summary:
   - Job Description: ~850 chars
   - Case Study Brief: ~4,722 chars
   - CV Rubric: ~3,596 chars
   - Project Rubric: ~4,558 chars
```

For detailed ingestion documentation, see [seed/README.md](seed/README.md).

---

## API Documentation

### Base URL

```
http://localhost:3000
```

### Endpoints

#### 1. Upload Files

**Endpoint:** `POST /upload`

**Description:** Upload candidate CV and Project Report (both must be PDF files)

**Request:**

- Method: POST
- Content-Type: multipart/form-data
- Fields:
  - `cv` (file, required) - Candidate's CV in PDF format
  - `project_report` (file, required) - Candidate's project report in PDF format

**Example (curl):**

```bash
curl -X POST http://localhost:3000/upload \
  -F "cv=@/path/to/candidate_cv.pdf" \
  -F "project_report=@/path/to/project_report.pdf"
```

**Response (201 Created):**

```json
{
  "cv_id": 1,
  "project_report_id": 1,
  "message": "Files uploaded successfully"
}
```

**File Validation:**

- Both files are required (CV and Project Report)
- Only PDF files accepted (validated by MIME type and extension)
- Maximum file size: 10MB per file
- Dual-layer validation (Multer + validation pipes)

**Error Responses:**

- `400 Bad Request` - Missing files, invalid file format, or file too large
- `503 Service Unavailable` - Object storage or upload persistence unavailable

**Example Error Messages:**

```json
// Missing file
{ "statusCode": 400, "message": "Project Report file is required (PDF format)" }

// Invalid file type
{ "statusCode": 400, "message": "CV must be a PDF file. Got MIME type: image/jpeg" }

// File too large
{ "statusCode": 400, "message": "CV is too large. Maximum size is 10MB, got 12.3MB" }
```

---

#### 2. Start Evaluation

**Endpoint:** `POST /evaluate`

**Description:** Trigger asynchronous AI evaluation pipeline. Returns immediately with a job ID.

**Request:**

- Method: POST
- Content-Type: application/json
- Body:

```json
{
  "job_title": "Backend Developer",
  "cv_id": 1,
  "project_report_id": 1
}
```

**Example (curl):**

```bash
curl -X POST http://localhost:3000/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "job_title": "Backend Developer",
    "cv_id": 1,
    "project_report_id": 1
  }'
```

**Response (201 Created):**

```json
{
  "id": 456,
  "status": "queued"
}
```

**Error Responses:**

- `400 Bad Request` - CV or Project Report not found with given IDs
- `503 Service Unavailable` - Evaluation could not be added to the queue
- `500 Internal Server Error` - Database error

**Note:** The evaluation process runs asynchronously. The response only contains the evaluation ID, not the results. Use the `/result/:id` endpoint to check status and retrieve results.

---

#### 3. Get Evaluation Result

**Endpoint:** `GET /result/:id`

**Description:** Retrieve the status and result of an evaluation job

**Request:**

- Method: GET
- URL Parameter: `id` (integer) - Evaluation ID from POST /evaluate

**Example (curl):**

```bash
curl http://localhost:3000/result/456
```

**Response - Queued/Processing:**

```json
{
  "id": 456,
  "status": "queued"
}
```

or

```json
{
  "id": 456,
  "status": "processing",
  "partial_result": {
    "project_score": 4.5,
    "project_feedback": "Excellent implementation with clear documentation."
  }
}
```

`partial_result` is present only when at least one valid CV or project
checkpoint is available. It exposes the same summary fields as the completed
response; the full scoring and reasoning payload remains internal.

**Response - Completed (200 OK):**

```json
{
  "id": 456,
  "status": "completed",
  "result": {
    "cv_match_rate": 0.82,
    "cv_feedback": "Strong in backend and cloud technologies with solid 3+ years of experience. Demonstrates good understanding of APIs and databases. Limited exposure to AI/LLM integration, which is increasingly relevant for the role. Communication skills are well-demonstrated through project descriptions.",
    "project_score": 4.5,
    "project_feedback": "Excellent implementation of prompt design and LLM chaining with proper RAG integration. Code structure is clean and modular with good use of TypeScript. Demonstrates solid error handling with retry tracking. Documentation is clear with good explanations of design choices. Minor improvements could be made in automated testing coverage.",
    "overall_summary": "Strong candidate with good technical fit for the backend role. Demonstrates solid backend engineering skills with 3+ years of experience in relevant technologies. Project implementation shows good understanding of AI/LLM workflows and system design. Would benefit from deeper exposure to production-scale AI systems, but overall shows strong potential and learning mindset."
  }
}
```

**Response - Failed:**

```json
{
  "id": 456,
  "status": "failed",
  "error_code": "LLM_UNAVAILABLE",
  "failed_stage": "CV_EVALUATION",
  "error_message": "AI evaluation service is temporarily unavailable",
  "retry_count": 3,
  "partial_result": {
    "project_score": 4.5,
    "project_feedback": "Excellent implementation with clear documentation."
  }
}
```

**Error Responses:**

- `404 Not Found` - Evaluation not found with given ID
- `500 Internal Server Error` - Database error

---

### API Usage Flow

```bash
# 1. Upload files
UPLOAD_RESPONSE=$(curl -X POST http://localhost:3000/upload \
  -F "cv=@cv.pdf" \
  -F "project_report=@report.pdf")

CV_ID=$(echo $UPLOAD_RESPONSE | jq -r '.cv_id')
PROJECT_ID=$(echo $UPLOAD_RESPONSE | jq -r '.project_report_id')

# 2. Start evaluation
EVAL_RESPONSE=$(curl -X POST http://localhost:3000/evaluate \
  -H "Content-Type: application/json" \
  -d "{\"job_title\":\"Backend Developer\",\"cv_id\":$CV_ID,\"project_report_id\":$PROJECT_ID}")

EVAL_ID=$(echo $EVAL_RESPONSE | jq -r '.id')

# 3. Poll for results (evaluation typically takes 30-90 seconds)
while true; do
  RESULT=$(curl http://localhost:3000/result/$EVAL_ID)
  STATUS=$(echo $RESULT | jq -r '.status')

  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
    echo $RESULT | jq .
    break
  fi

  echo "Status: $STATUS. Waiting..."
  sleep 5
done
```

---

## How It Works

### 1. File Upload Process

1. Client sends multipart/form-data with CV and Project Report PDFs
2. **Validation (Dual-Layer)**:
   - **Multer layer**: Validates file type (PDF only) and size (max 10MB)
   - **Pipe layer**: Validates both files are present and meet all requirements
3. `multer-s3` middleware uploads validated files directly to AWS S3
4. File metadata (original name, S3 key, URL) saved to PostgreSQL
5. Returns `cv_id` and `project_report_id` for later use

**File validation rules:**

- File type: PDF only (checked by MIME type `application/pdf` and extension `.pdf`)
- File size: Maximum 10MB per file
- Required files: Both CV and Project Report must be provided

**Key implementation:**

- Upload logic: `src/upload/upload.service.ts:8-34`
- Validation: `src/upload/validators/file-validation.pipe.ts`

### 2. Evaluation Initialization

1. Client requests evaluation with `job_title`, `cv_id`, `project_report_id`
2. System validates that CV and Project Report exist in database
3. Creates an Evaluation record with status `queued`
4. Adds job to BullMQ queue with evaluation parameters
5. Returns evaluation `id` immediately (non-blocking)

**Key implementation:** `src/evaluate/evaluate.service.ts:26-68`

### 3. Background Processing (The AI Pipeline)

The BullMQ worker (`evaluate.processor.ts`) executes these steps:

#### Step 1: Data Retrieval

```typescript
// Update status to 'processing'
// Fetch CV and Project Report PDFs from S3
// Retrieve ground truth documents from ChromaDB:
//   - Job Description (filtered by job_title)
//   - Case Study Brief
//   - CV Scoring Rubric
//   - Project Scoring Rubric
```

#### Step 2: Parallel Document Evaluation (Gemini Flash Lite)

The CV and project report calls are independent and run concurrently. Final synthesis starts only after both complete.

##### CV Evaluation

```typescript
Input:
  - CV PDF (as base64)
  - Job Description (from RAG)
  - CV Scoring Rubric (from RAG)
  - System Prompt (evaluation criteria & scoring guide)

Process:
  - Gemini analyzes PDF multimodally (text + structure)
  - Evaluates against 4 weighted parameters:
    * Technical Skills Match (40%)
    * Experience Level (25%)
    * Relevant Achievements (20%)
    * Cultural/Collaboration Fit (15%)

Output (JSON):
  {
    "technical_skills_score": 4,
    "technical_skills_reasoning": "...",
    "experience_score": 3,
    "experience_reasoning": "...",
    "achievements_score": 4,
    "achievements_reasoning": "...",
    "cultural_fit_score": 4,
    "cultural_fit_reasoning": "...",
    "cv_match_rate": 0.82,  // Weighted average × 0.2
    "cv_feedback": "..."
  }
```

**Key implementation:** `src/evaluate/evaluate.service.ts:175-210`

##### Project Report Evaluation

```typescript
Input:
  - Project Report PDF (as base64)
  - Case Study Brief (from RAG)
  - Project Scoring Rubric (from RAG)
  - System Prompt (evaluation criteria & scoring guide)

Process:
  - Gemini analyzes implementation quality
  - Evaluates against 5 weighted parameters:
    * Correctness (30%)
    * Code Quality (25%)
    * Resilience & Error Handling (20%)
    * Documentation (15%)
    * Creativity/Bonus (10%)

Output (JSON):
  {
    "correctness_score": 5,
    "correctness_reasoning": "...",
    "code_quality_score": 4,
    "code_quality_reasoning": "...",
    "resilience_score": 4,
    "resilience_reasoning": "...",
    "documentation_score": 4,
    "documentation_reasoning": "...",
    "creativity_score": 3,
    "creativity_reasoning": "...",
    "project_score": 4.5,  // Weighted average (1-5 scale)
    "project_feedback": "..."
  }
```

**Key implementation:** `src/evaluate/evaluate.service.ts:212-247`

#### Step 3: Final Synthesis (Gemini Flash)

```typescript
Input:
  - CV Evaluation Results (all scores + reasoning)
  - Project Evaluation Results (all scores + reasoning)
  - System Prompt (synthesis guidelines)

Process:
  - Gemini Flash integrates both evaluations
  - Provides holistic assessment
  - Generates actionable summary

Output (JSON):
  {
    "overall_summary": "Strong candidate with good technical fit..."
  }
```

**Key implementation:** `src/evaluate/evaluate.service.ts:249-298`

#### Step 4: Result Storage

```typescript
// After each independent document stage succeeds:
//   - Save the full validated payload as a JSON checkpoint
//   - Save its public score and feedback fields atomically
//   - Preserve a successful sibling when the other stage fails
// On BullMQ retry:
//   - Validate and reuse existing checkpoints
//   - Skip their S3, ChromaDB, and LLM calls
// After final synthesis succeeds:
//   - Save overall_summary
// Update status to 'completed'
// Record completion timestamp
```

### 4. Error Handling & Retry Mechanism

**LLM-level retries (automatic with exponential backoff):**

```typescript
await retryExecutor.execute(operation, callGemini, {
  maxAttempts: 2,
  // Timeouts, HTTP 429/5xx, and network failures are transient.
});
```

External calls are also protected by a process-local circuit breaker outside
their retry sequence:

```text
BullMQ job attempt
    ↓
Circuit breaker
    ↓
Local retry + timeout
    ↓
External service
```

The protected services have independent state:

- `gemini`: generation and embedding operations share one circuit.
- `chroma`: collection lookup and vector queries; Gemini embeddings are
  generated before entering the Chroma query circuit.
- `s3`: every AWS SDK command, including `multer-s3` upload, read, delete, and
  cleanup. The initialize middleware sits outside AWS SDK internal retries.
- `redis`: only the application enqueue gateway. BullMQ worker polling,
  heartbeat, reconnect behavior, and PostgreSQL are not protected.

After three consecutive transient operation failures, the relevant circuit
opens. Calls then fail fast for 30 seconds. The next call becomes the single
half-open probe: success closes the circuit, while a transient failure reopens
it. Permanent errors and domain validation failures do not increment the
breaker. Because each breaker wraps the whole retry sequence, two exhausted
local attempts count as one circuit failure.

The operation that reaches the threshold still returns its original service
error and follows the normal BullMQ retry rules. A later job that encounters an
already-open circuit is terminal (`retryable: false`) so BullMQ does not consume
all attempts during the cooldown. After cooldown, a new request or job supplies
the probe; previously failed jobs are not restarted automatically.

**Processor-level error handling:**

```typescript
try {
  // Execute evaluation pipeline (3 stages)
  // Each stage automatically retries on transient failures
} catch (error) {
  // Log error with detailed context
  // Increment retry_count once per failed processing attempt.
  // Retryable + attempts remaining: set queued and throw to BullMQ.
  // Valid CV/project checkpoints remain available for the next attempt.
  // A checkpoint write failure is retryable at SAVE_CHECKPOINT.
  // Permanent: persist structured failure and throw UnrecoverableError.
  // Exhausted: persist structured terminal failure.
}
```

**Key implementation:**

- Retry logic: `src/shared/retry.executor.ts`, `src/shared/retry.utils.ts`
- Error mapping: `src/shared/pipeline-error.ts`
- Processor error handling: `src/evaluate/evaluate.processor.ts`
- LLM service: `src/shared/llm.service.ts`
- Circuit breaker registry: `src/shared/circuit-breaker.executor.ts`

### 5. RAG (Retrieval-Augmented Generation)

ChromaDB serves as the "ground truth" knowledge base:

```typescript
// Example: Getting job description
const jobDescription =
  await chromaService.getJobDescription('Backend Developer');

// Under the hood:
// 1. Embed the query using Google Gemini embeddings
// 2. Perform semantic search in ChromaDB
// 3. Filter by metadata: { type: 'job_description' }
// 4. Return the most relevant document (nResults: 1)
```

**Benefits:**

- Semantic matching (not just keyword search)
- Easy to add more job descriptions or roles
- Decouples evaluation logic from reference data
- Enables flexible querying with metadata filters

**Key implementation:** `src/shared/chroma.service.ts`

---

## Design Decisions & Trade-offs

### 1. 3-Stage Pipeline (Not 5-Stage)

**Decision:** Use 3 LLM calls instead of potential 5+ calls

**Stages:**

1. CV Evaluation
2. Project Report Evaluation
3. Final Synthesis

**Rejected alternatives:**

- ❌ Separate calls for extration and scoring (too expensive, too slow)
- ❌ Cross-validation step (adds complexity, limited value)
- ❌ Single mega-prompt (poor separation of concerns, harder to debug)

**Trade-offs:**

- ✅ **Pro:** Cost-efficient (3 API calls vs 10+ calls)
- ✅ **Pro:** Faster execution (30-60 seconds vs 2-3 minutes)
- ✅ **Pro:** Easier to debug and maintain
- ✅ **Pro:** Still achieves high-quality results
- ⚠️ **Con:** Less granular control over each parameter evaluation
- ⚠️ **Con:** Can't easily retry individual parameter scoring

**Why this matters:** Given the 5-day deadline and API cost constraints, this 3-stage approach provides the best balance of quality, speed, and cost.

---

### 2. Strategic Model Selection

**Decision:** Use Gemini Flash Lite for analysis, Gemini Flash for synthesis

| Task               | Model      | Reasoning                                                                  |
| ------------------ | ---------- | -------------------------------------------------------------------------- |
| CV Evaluation      | Flash Lite | Good enough for structured scoring, multimodal PDF support, cost-effective |
| Project Evaluation | Flash Lite | Same as CV, consistent approach                                            |
| Final Synthesis    | Flash      | Better reasoning, higher quality summaries                                 |

---

### 3. Async Processing with BullMQ

**Decision:** Use job queue instead of synchronous processing

**Why:**

- ✅ Evaluation takes 30-90 seconds (unacceptable for synchronous HTTP request)
- ✅ Enables retry mechanisms for failed jobs
- ✅ Provides monitoring and job history
- ✅ Scales horizontally (can add more workers)
- ✅ Client gets immediate response (job ID)

**Alternative considered:**

- Synchronous processing with long timeout → Rejected: Poor UX, ties up server resources
- Server-Sent Events (SSE) for real-time updates → Rejected: Added complexity, not required

**Trade-off:**

- ⚠️ **Con:** Requires Redis infrastructure
- ⚠️ **Con:** Client must poll or use webhooks (added complexity)
- ✅ **Pro:** Professional production-ready pattern
- ✅ **Pro:** Much better UX and scalability

---

### 4. Direct PDF Processing (No Intermediate Parsing)

**Decision:** Send PDF directly to Gemini multimodal API, no preprocessing

**Why:**

- ✅ Simpler code (no PDF parsing libraries needed)
- ✅ Gemini understands document structure (headings, lists, tables)
- ✅ Preserves visual formatting context
- ✅ No loss of information from conversion

**Alternatives considered:**

- `pdf-parse` library → Rejected: Loses structure, struggles with complex layouts
- OCR + text extraction → Rejected: Overkill for digital PDFs
- Convert to Markdown → Rejected: Extra processing step, potential data loss

**Trade-off:**

- ⚠️ **Con:** Dependent on Gemini's PDF processing quality
- ⚠️ **Con:** Larger request payload (base64 encoding)
- ✅ **Pro:** Higher accuracy and context preservation
- ✅ **Pro:** Less code to maintain

---

### 5. RAG with ChromaDB (Not Just Direct File Reading)

**Decision:** Use vector database for ground truth documents

**Why:**

- ✅ Semantic search (matches "Backend Engineer" with "Backend Developer")
- ✅ Scales to multiple roles/job descriptions easily
- ✅ Metadata filtering (type, role, etc.)
- ✅ Decouples evaluation logic from reference data
- ✅ Easy to update rubrics without code changes

**Alternatives considered:**

- Store rubrics in code constants → Rejected: Hard to maintain, no semantic search
- Store in PostgreSQL → Rejected: No semantic matching capabilities
- Read files directly → Rejected: No flexibility, hard-coded paths

**Trade-off:**

- ⚠️ **Con:** Requires ChromaDB infrastructure
- ⚠️ **Con:** Ingestion step needed before first use
- ✅ **Pro:** Professional RAG implementation
- ✅ **Pro:** Demonstrates AI engineering best practices
- ✅ **Pro:** Easy to extend to multiple roles

---

### 6. Temperature Control Strategy

**Decision:** Use different temperature settings for different tasks

| Task                     | Temperature | Reasoning                                             |
| ------------------------ | ----------- | ----------------------------------------------------- |
| Seeding (PDF extraction) | 0.1         | Need consistency, same PDF should extract identically |
| CV Evaluation            | 0.3         | Balanced: some creativity, mostly consistent scoring  |
| Project Evaluation       | 0.3         | Same as CV for fairness                               |
| Final Synthesis          | 0.3         | Slightly creative summaries, but still grounded       |

**Why not 0.0?**

- Temperature 0.0 can sometimes produce repetitive or overly rigid outputs
- 0.3 provides good balance of consistency and natural language quality

**Why not higher (0.7+)?**

- Evaluation scores should be consistent for same input
- High randomness would make scoring unreliable

---

### 7. Error Handling & Retry Strategy

**Current implementation:**

- ✅ **File upload validation** (dual-layer: Multer + validation pipes)
- ✅ **Automatic retry with exponential backoff** for LLM API calls
- ✅ **Smart error classification** (retryable vs permanent errors)
- ✅ Per-service circuit breakers for Gemini, Chroma, S3, and Redis enqueue
- ✅ Structured public errors with error code and failed stage
- ✅ Internal causes logged without exposing them through the database/API
- ✅ Retry count tracks failed worker processing attempts
- ✅ Pending Bull retries return records to `queued`; only terminal failures become `failed`
- ✅ Uploaded objects are cleaned up after pair validation or database persistence failures
- ✅ Input validation for API requests

**File validation includes:**

- File type validation (PDF only, by MIME type and extension)
- File size validation (max 10MB)
- Required files check (both CV and Project Report)
- Clear, actionable error messages

**Retry mechanism with exponential backoff:**

Implemented through injectable retry policies and infrastructure gateways:

| Boundary                 | Total attempts | Backoff                                      |
| ------------------------ | -------------- | -------------------------------------------- |
| Each Gemini operation    | 2              | Exponential, bounded, 20% jitter             |
| Redis enqueue            | 2              | Same stable `jobId` for idempotency          |
| Each BullMQ worker job   | 3              | Exponential from 1 second, 20% jitter        |
| E2E equivalents          | Same counts    | Short delays and no jitter for deterministic |

**Retry-able errors (will retry):**

- Network timeouts (ETIMEDOUT, EHOSTUNREACH)
- Rate limiting (HTTP 429)
- Service unavailable (HTTP 503, 504)
- Connection errors (ECONNREFUSED, ECONNRESET)

**Non-retryable errors (fail immediately):**

- Authentication failures (HTTP 401, 403)
- Bad requests (HTTP 400, 404)
- Invalid API keys
- Malformed requests

**Example retry flow:**

```
Gemini attempt 1: Rate limit (429) → bounded wait
Gemini attempt 2: still unavailable → BullMQ schedules the next job attempt
```

**Circuit breaker behavior:**

| Setting | Default | Behavior |
| --- | ---: | --- |
| `CIRCUIT_BREAKER_ENABLED` | `true` | Set to `false` to bypass breakers only |
| `CIRCUIT_BREAKER_FAILURE_THRESHOLD` | `3` | Consecutive transient operation failures before open |
| `CIRCUIT_BREAKER_RESET_TIMEOUT_MS` | `30000` | Cooldown before one half-open probe |

The public API remains service-oriented. An open circuit maps to
`QUEUE_UNAVAILABLE`, `STORAGE_UNAVAILABLE`, `KNOWLEDGE_BASE_UNAVAILABLE`, or
`LLM_UNAVAILABLE` according to the pipeline stage. Circuit state, provider, and
operation are retained only in internal errors and logs; they are not added to
the response schema or database schema.

**Implementation details:** `src/shared/retry.executor.ts`, `src/shared/circuit-breaker.executor.ts`, `src/shared/pipeline-error.ts`, and `src/evaluate/evaluate.processor.ts`

**Not implemented (future work):**

- ❌ Partial result storage (if one stage succeeds but next fails)

**Reasoning:** Bounded retries handle brief failures within one operation, while
the circuit breakers stop repeated calls to an unhealthy dependency. BullMQ
continues to own whole-job retries and persisted worker state.

---

### 8. Database Schema Decisions

**Key design choices:**

1. **Separate CV and ProjectReport models**
   - Why: Different entities, can exist independently
   - Alternative: Store both in single Document table → Rejected for clarity

2. **Evaluation links to both CV and ProjectReport**
   - Why: One evaluation per CV-Project pair
   - Tracks full lineage of evaluation

3. **Status enum (queued, processing, completed, failed)**
   - Why: Clear state machine, easy to query
   - Alternative: Boolean flags → Rejected as less clear

4. **Nullable result fields**
   - Why: Populated independently as their pipeline stages complete
   - Supports partial responses while preserving the completed response shape

5. **JSON checkpoints for CV and project evaluation**
   - Why: Final synthesis needs the complete validated scores and reasoning
   - Allows BullMQ retries to resume without repeating successful LLM calls

6. **Timing fields (started_at, completed_at)**
   - Why: Performance monitoring, debugging
   - Can track evaluation duration

7. **Error tracking (error_message, retry_count)**
   - Why: Debugging failed evaluations
   - Support for retry mechanisms

---

### 9. File Upload to S3 (Not Local Storage)

**Decision:** Upload files directly to AWS S3

**Why:**

- ✅ Scalable storage (no local disk limits)
- ✅ Files accessible from multiple workers
- ✅ Built-in redundancy and durability
- ✅ Easy to implement signed URLs for secure access
- ✅ Standard production pattern

**Alternative considered:**

- Local filesystem → Rejected: Doesn't scale, lost on server restart
- Database BLOB storage → Rejected: Poor performance for large files

**Trade-off:**

- ⚠️ **Con:** Requires AWS account and configuration
- ⚠️ **Con:** Additional latency for file retrieval
- ✅ **Pro:** Production-ready architecture
- ✅ **Pro:** Demonstrates cloud-native thinking

---

## Testing

### Current Testing Status

The automated suite contains **118 unit tests** and **10 E2E scenarios**. Unit tests isolate services. E2E starts real PostgreSQL, Redis/BullMQ, ChromaDB, and MinIO while replacing only Gemini generation/embeddings with a deterministic fake. It applies migrations, seeds Chroma from literal documents, runs serially, and always removes the isolated Compose project and volumes through a cleanup trap.

```bash
# Unit tests
pnpm test

# Full local-infrastructure E2E (Docker required; no real Gemini key/network call)
pnpm run test:e2e

# Unit tests with enforced coverage threshold
pnpm run test:cov

# Static quality gates
pnpm run lint
pnpm run typecheck
pnpm run build
```

### Manual Testing Guide

#### 1. Test File Upload

```bash
curl -X POST http://localhost:3000/upload \
  -F "cv=@seed/Resume Harun Al Rasyid.pdf" \
  -F "project_report=@seed/Project Report - Harun Al Rasyid.pdf"
```

Expected: Returns `cv_id` and `project_report_id`

#### 2. Test Evaluation Start

```bash
curl -X POST http://localhost:3000/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "job_title": "Backend Developer",
    "cv_id": 1,
    "project_report_id": 1
  }'
```

Expected: Returns evaluation `id` with status `queued`

#### 3. Test Result Retrieval

```bash
# Check immediately (should be queued or processing)
curl http://localhost:3000/result/1

# Wait 30-60 seconds, check again (should be completed)
curl http://localhost:3000/result/1
```

Expected:

- First call: `status: "queued"` or `"processing"`
- Second call: `status: "completed"` with full results

#### 4. Test File Validation

```bash
# Test missing file
curl -X POST http://localhost:3000/upload \
  -F "cv=@seed/Resume Harun Al Rasyid.pdf"

# Expected: 400 - "Project Report file is required (PDF format)"

# Test invalid file type
curl -X POST http://localhost:3000/upload \
  -F "cv=@test.docx" \
  -F "project_report=@test.pdf"

# Expected: 400 - "Only PDF files are allowed"

# Test file too large (create 11MB file first)
dd if=/dev/zero of=large.pdf bs=1M count=11
curl -X POST http://localhost:3000/upload \
  -F "cv=@large.pdf" \
  -F "project_report=@test.pdf"

# Expected: 400 - "CV is too large. Maximum size is 10MB"
```

#### 5. Test Error Handling

```bash
# Invalid CV ID
curl -X POST http://localhost:3000/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "job_title": "Backend Developer",
    "cv_id": 99999,
    "project_report_id": 1
  }'
```

Expected: 400 Bad Request with error message

### Live Integration Checks

Use `pnpm ts-node seed/test-chromadb.ts` after production-style PDF seeding to inspect a development Chroma collection. The automated E2E suite deliberately uses real local infrastructure plus fake external AI; live Gemini and AWS S3 smoke checks remain separate and optional.

---

## Future Improvements

### Priority 1: Production Readiness

1. **Automated Tests**
   - ✅ Unit tests for services (80% coverage threshold)
   - ✅ Integration tests for API endpoints
   - ✅ E2E tests with real local PostgreSQL, Redis, ChromaDB, and MinIO
   - [ ] Optional live Gemini and AWS S3 smoke tests

2. **Advanced Error Handling**
   - ✅ ~~Exponential backoff for LLM API retries~~ **(IMPLEMENTED)**
   - [x] Circuit breaker for external services **(IMPLEMENTED)**
   - [x] Partial result storage (checkpoint evaluation progress) **(IMPLEMENTED)**
   - Advanced rate limit handling with adaptive backoff

3. **Monitoring & Observability**
   - Structured logging (Winston or Pino)
   - Metrics (Prometheus)
   - Distributed tracing (OpenTelemetry)
   - Health check endpoints

### Priority 2: Feature Enhancements

4. **API Improvements**
   - Swagger/OpenAPI documentation
   - API versioning
   - ✅ Request validation (class-validator)
   - Rate limiting (per user/IP)

5. **Authentication & Authorization**
   - JWT-based authentication
   - Role-based access control (RBAC)
   - API key management for programmatic access

6. **Webhook Support**
   - Callback URLs for evaluation completion
   - Event-driven notifications

### Priority 3: Scalability & Performance

7. **Caching Layer**
   - Cache vector DB queries (Redis)
   - Cache frequent job descriptions
   - Response caching for identical CVs

8. **Performance Optimizations**
   - ✅ Parallel LLM calls where possible
   - Connection pooling for database
   - S3 request optimization

9. **Horizontal Scaling**
   - Multiple worker instances
   - Load balancer configuration
   - Distributed job queue

### Priority 4: User Experience

10. **Dashboard UI**
    - Web interface for evaluation management
    - Real-time status updates (WebSockets)
    - Evaluation history and analytics

11. **Batch Processing**
    - Upload and evaluate multiple candidates at once
    - Comparative analysis reports

12. **Email Notifications**
    - Notify when evaluation completes
    - Weekly summary reports

### Priority 5: DevOps

13. **Containerization**
    - ✅ Docker Compose for local development
    - [ ] Kubernetes manifests for production

14. **CI/CD Pipeline**
    - Automated testing on PR
    - Automated deployment
    - Database migration automation

15. **Infrastructure as Code**
    - Terraform for AWS resources
    - Environment-specific configurations

---

## License

UNLICENSED - Case Study Project

---

## Author

**Harun Al Rasyid**

Built as part of a Backend Developer case study assessment focusing on AI/LLM integration, RAG implementation, and production-ready system design.
