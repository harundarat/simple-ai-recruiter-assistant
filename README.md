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
- **Robust Error Handling** with retry tracking and detailed error messages
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
│  5. Save results to database             │
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

Stage 3: Final Synthesis
├─ Input: Results from Stage 1 + Stage 2
├─ Model: Gemini Flash (stronger reasoning capabilities)
├─ Output: overall_summary
└─ Reasoning: Better at synthesis and summarization
```

---

## Tech Stack

### Backend Framework
- **NestJS** - Progressive Node.js framework with TypeScript
- **TypeScript** - Type safety and better developer experience

### Database & Storage
- **PostgreSQL** - Primary database for structured data
- **Prisma ORM** - Type-safe database access and migrations
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
│   │   └── upload.module.ts
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
│   │   ├── s3.service.ts         # AWS S3 operations
│   │   ├── llm.service.ts        # Gemini API wrapper
│   │   ├── chroma.service.ts     # ChromaDB vector search
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

1. **Node.js** (v18 or higher)
2. **pnpm** package manager
3. **PostgreSQL** (v14 or higher)
4. **Redis** (for BullMQ)
5. **ChromaDB** (vector database)
6. **AWS Account** with S3 bucket configured
7. **Google Gemini API Key**

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

### 3. Set up external services

#### PostgreSQL
```bash
# Install PostgreSQL if not already installed
# Create a database
createdb ai_recruiter_db
```

#### Redis
```bash
# Using Docker 
docker run -d -p 6379:6379 redis:alpine
```

#### ChromaDB
```bash
# Using Docker 
docker run -d -p 8000:8000 chromadb/chroma
```

---

## Configuration

### 1. Create `.env` file

Create a `.env` file in the project root with the following variables:

```env
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/ai_recruiter_db"

# Redis (for BullMQ)
REDIS_HOST="localhost"
REDIS_PORT="6379"

# AWS S3
AWS_REGION="ap-southeast-1"
AWS_ACCESS_KEY_ID="your-aws-access-key"
AWS_SECRET_ACCESS_KEY="your-aws-secret-key"
S3_BUCKET_NAME="your-bucket-name"

# Google Gemini API
GOOGLE_GEMINI_API_KEY="your-gemini-api-key"

# ChromaDB
CHROMA_HOST="localhost"
CHROMA_PORT="8000"

# Application
PORT="3000"
NODE_ENV="development"
```

### 2. Run database migrations

```bash
pnpm prisma migrate deploy
```

### 3. Generate Prisma client

```bash
pnpm prisma generate
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
pnpm ts-node seed/seeder-pdf.ts
```

**What this does:**
- Reads the PDF using Gemini multimodal AI
- Extracts 4 distinct sections:
  1. Job Description
  2. Case Study Brief
  3. CV Scoring Rubric
  4. Project Scoring Rubric
- Validates each section (character count checks)
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

**Response (200 OK):**
```json
{
  "cv_id": 1,
  "project_report_id": 1,
  "message": "Files uploaded successfully"
}
```

**Error Responses:**
- `400 Bad Request` - Missing files or invalid file format
- `500 Internal Server Error` - S3 upload failure or database error

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

**Response (200 OK):**
```json
{
  "id": 456
}
```

**Error Responses:**
- `400 Bad Request` - CV or Project Report not found with given IDs
- `500 Internal Server Error` - Database error or queue failure

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
curl http://localhost:3000/evaluate/result/456
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
  "status": "processing"
}
```

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
  "error_message": "LLM API timeout after 3 retry attempts"
}
```

**Error Responses:**
- `400 Bad Request` - Evaluation not found with given ID
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
  RESULT=$(curl http://localhost:3000/evaluate/result/$EVAL_ID)
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
2. `multer-s3` middleware uploads files directly to AWS S3
3. File metadata (original name, S3 key, URL) saved to PostgreSQL
4. Returns `cv_id` and `project_report_id` for later use

**Key implementation:** `src/upload/upload.service.ts:8-34`

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

#### Step 2: CV Evaluation (Gemini Flash Lite)
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

#### Step 3: Project Report Evaluation (Gemini Flash Lite)
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

#### Step 4: Final Synthesis (Gemini Flash)
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

#### Step 5: Result Storage
```typescript
// Save all results to database:
//   - cv_match_rate, cv_feedback
//   - project_score, project_feedback
//   - overall_summary
// Update status to 'completed'
// Record completion timestamp
```

### 4. Error Handling

If any step fails:
```typescript
try {
  // Execute evaluation pipeline
} catch (error) {
  // Log error details
  // Increment retry_count
  // Store error_message
  // Update status to 'failed'
  // Throw error (BullMQ will handle retry if configured)
}
```

**Key implementation:** `src/evaluate/evaluate.processor.ts:26-85`

### 5. RAG (Retrieval-Augmented Generation)

ChromaDB serves as the "ground truth" knowledge base:

```typescript
// Example: Getting job description
const jobDescription = await chromaService.getJobDescription("Backend Developer");

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

| Task | Model | Reasoning |
|------|-------|-----------|
| CV Evaluation | Flash Lite | Good enough for structured scoring, multimodal PDF support, cost-effective |
| Project Evaluation | Flash Lite | Same as CV, consistent approach |
| Final Synthesis | Flash | Better reasoning, higher quality summaries |

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

| Task | Temperature | Reasoning |
|------|-------------|-----------|
| Seeding (PDF extraction) | 0.1 | Need consistency, same PDF should extract identically |
| CV Evaluation | 0.3 | Balanced: some creativity, mostly consistent scoring |
| Project Evaluation | 0.3 | Same as CV for fairness |
| Final Synthesis | 0.3 | Slightly creative summaries, but still grounded |

**Why not 0.0?**
- Temperature 0.0 can sometimes produce repetitive or overly rigid outputs
- 0.3 provides good balance of consistency and natural language quality

**Why not higher (0.7+)?**
- Evaluation scores should be consistent for same input
- High randomness would make scoring unreliable

---

### 7. Error Handling Strategy

**Current implementation:**
- ✅ Try-catch blocks around LLM calls
- ✅ Error messages stored in database
- ✅ Retry count tracking
- ✅ Status updates (failed state)

**Not implemented (future work):**
- ❌ Automatic retry with exponential backoff
- ❌ Rate limit handling
- ❌ Partial result storage (if one stage succeeds but next fails)
- ❌ Circuit breaker pattern

**Reasoning:** Basic error handling is sufficient for MVP/case study. Production system would need more robust retry mechanisms.

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
   - Why: Only populated when status = completed
   - Enforces data integrity

5. **Timing fields (started_at, completed_at)**
   - Why: Performance monitoring, debugging
   - Can track evaluation duration

6. **Error tracking (error_message, retry_count)**
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

**Implemented:**
- ✅ Manual end-to-end testing via API calls
- ✅ ChromaDB ingestion verification script

**Not Implemented:**
- ❌ Unit tests
- ❌ Integration tests
- ❌ E2E automated tests

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
curl http://localhost:3000/evaluate/result/1

# Wait 30-60 seconds, check again (should be completed)
curl http://localhost:3000/evaluate/result/1
```

Expected:
- First call: `status: "queued"` or `"processing"`
- Second call: `status: "completed"` with full results

#### 4. Test Error Handling

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

### Future Testing Plan

**Unit Tests (Recommended):**
```typescript
// Example: src/evaluate/evaluate.service.spec.ts
describe('EvaluateService', () => {
  it('should calculate cv_match_rate correctly', () => {
    // Test weighted average calculation
  });

  it('should handle missing documents gracefully', () => {
    // Test error handling
  });
});
```

**Integration Tests:**
- Test full evaluation pipeline with mock LLM responses
- Test ChromaDB retrieval with seeded test data
- Test S3 upload/download operations

**E2E Tests:**
- Upload → Evaluate → Retrieve full flow
- Test async processing with job queue

---

## Future Improvements

### Priority 1: Production Readiness
1. **Automated Tests**
   - Unit tests for services (target: 80% coverage)
   - Integration tests for API endpoints
   - E2E tests for critical user flows

2. **Advanced Error Handling**
   - Exponential backoff for LLM API retries
   - Circuit breaker for external services
   - Partial result storage (checkpoint evaluation progress)
   - Rate limit handling with queuing

3. **Monitoring & Observability**
   - Structured logging (Winston or Pino)
   - Metrics (Prometheus)
   - Distributed tracing (OpenTelemetry)
   - Health check endpoints

### Priority 2: Feature Enhancements
4. **API Improvements**
   - Swagger/OpenAPI documentation
   - API versioning
   - Request validation (class-validator)
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
   - Parallel LLM calls where possible
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
    - Docker Compose for local development
    - Kubernetes manifests for production

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
