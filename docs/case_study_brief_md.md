# Case Study Brief (Markdown Version)

## Introduction
Hello! Thank you for applying with us as a backend developer. This mini project should be completed within 5 days after you receive this document. Please spare your time to complete this project with the best results. We are happy to answer any questions if anything is unclear.

---

## Objective
Your mission is to build a backend service that automates the initial screening of a job application. The service will:
- Receive a candidate's CV and project report
- Evaluate them against a job description and case study brief
- Produce a structured, AI-generated evaluation report

---

## Core Logic & Data Flow
### Candidate-Provided Inputs
- **Candidate CV** (PDF)
- **Project Report** (PDF)

### System-Internal Documents (Ground Truth)
- **Job Description** (used to evaluate CV)
- **Case Study Brief** (this document; used to evaluate Project Report)
- **Scoring Rubric** (PDF)

These documents must be ingested into a vector database for retrieval.

---

## Deliverables
### 1. Backend Service (API Endpoints)
Implement at least these endpoints:

#### `POST /upload`
- Accept `multipart/form-data` containing CV + Project Report (PDF)
- Store each file and return ID references

#### `POST /evaluate`
- Trigger asynchronous AI evaluation pipeline
- Accept job title and document IDs
- Return job ID immediately

Example:
```json
{
  "id": "456",
  "status": "queued"
}
```

#### `GET /result/{id}`
- Return job status or final evaluation result

Completed example:
```json
{
  "id": "456",
  "status": "completed",
  "result": {
    "cv_match_rate": 0.82,
    "cv_feedback": "Strong in backend and cloud...",
    "project_score": 4.5,
    "project_feedback": "Meets prompt chaining requirements...",
    "overall_summary": "Good candidate fit, would benefit from deeper RAG knowledge..."
  }
}
```

---

## 2. Evaluation Pipeline
The pipeline should include:

### RAG (Retrieval-Augmented Generation)
- Ingest Job Description, Case Study Brief, Scoring Rubrics
- Retrieve relevant sections per evaluation type

### CV Evaluation
- Parse CV into structured data
- Retrieve Job Description + CV Scoring Rubric context
- Use LLM to produce:
  - `cv_match_rate`
  - `cv_feedback`

### Project Report Evaluation
- Parse report
- Retrieve Case Study Brief + Report Scoring Rubric context
- Use LLM to produce:
  - `project_score`
  - `project_feedback`

### Final Analysis
- Final LLM call to create `overall_summary`

### Long-Running Process Handling
- `POST /evaluate` must be async
- Use job queue or background worker
- `GET /result/:id` checks status

### Error Handling & Randomness Control
- Simulate edge cases
- Retry on LLM API failure
- Adjust temperature or validate outputs

---

## 3. Standardized Evaluation Parameters
### CV Evaluation Parameters
- Technical Skills Match
- Experience Level
- Relevant Achievements
- Cultural Fit

### Project Deliverable Evaluation
- Correctness
- Code Quality
- Resilience
- Documentation
- Creativity / Bonus

Each scored **1–5**, aggregated accordingly.

---

## Requirements
- Any backend framework (Rails, Django, Node.js, etc.)
- Use real LLM API (OpenAI, Gemini, OpenRouter, etc.)
- Use vector DB (Chroma, Qdrant, etc.)
- Provide README + ingestion scripts for reproducibility

---

## Scoring Rubric Summary
### CV Match Evaluation Weights
- Technical Skills: 40%
- Experience Level: 25%
- Relevant Achievements: 20%
- Cultural Fit: 15%

### Project Deliverable Evaluation Weights
- Correctness: 30%
- Code Quality: 25%
- Resilience: 20%
- Documentation: 15%
- Creativity: 10%

---

## Study Case Submission Template
### 1. Title

### 2. Candidate Information
- Full Name
- Email Address

### 3. Repository Link
(Do NOT include the word "Rakamin" anywhere)

### 4. Approach & Design
Describe:
- Initial plan
- System & DB design
- API design
- Job queue logic
- LLM integration
- Prompt design
- Retrieval strategy
- Error handling
- Edge cases considered

### 5. Results & Reflection
- What worked
- What didn’t
- Evaluation analysis
- Future improvements

### 6. Screenshots of Real Responses
- `POST /evaluate` output
- `GET /result/:id` final evaluation

### 7. Optional Bonus Features
Describe extra enhancements.

---

## Job Description — Product Engineer (Backend)
### About the Job
Responsibilities include:
- Building product features
- Backend development
- AI-powered system design
- Prompt engineering & LLM chaining
- RAG implementation
- Long-running task handling
- Code quality and testing
- Collaboration with frontend & PM

### Required Skills
- Databases (MySQL, PostgreSQL, MongoDB)
- REST APIs
- Cloud (AWS, GCP, Azure)
- Backend languages (Java, Python, Ruby, JS)
- Authentication & authorization
- Scalable system design
- Automated testing
- Familiarity with LLM APIs, embeddings, vector DBs

### Benefits
- 17 days PTO
- Learning budget (Rp29M/year)
- Device ownership (Rp7M/year)
- Remote work (Indonesia only)

