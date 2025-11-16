# Seed Data Ingestion System

## Overview

This folder contains scripts and source files for ingesting evaluation data into ChromaDB. The system uses Google Gemini's multimodal AI to extract structured sections from PDF case study documents and stores them as vector embeddings for semantic search.

**Purpose**: Populate ChromaDB with ground truth data (job descriptions, case study briefs, and evaluation rubrics) that will be used to evaluate candidate CVs and project submissions.

---

## File Structure

```
seed/
├── README.md                              # This file
├── seeder-pdf.ts                          # Main ingestion script
├── test-chromadb.ts                       # Test script to verify data
├── backend_case_study_clean.md            # Source markdown (backend role)
├── backend_case_study_clean.pdf           # Clean PDF for ingestion (backend)
└── blockchain_developer_case_study.pdf    # Clean PDF for ingestion (blockchain)
```

### File Descriptions

| File | Purpose |
|------|---------|
| `seeder-pdf.ts` | Main script that extracts sections from PDF using Gemini AI and upserts to ChromaDB |
| `test-chromadb.ts` | Verification script to test document retrieval and semantic search |
| `*.md` | Source markdown files used to generate clean PDFs |
| `*.pdf` | Well-structured PDF files ready for AI extraction |

---

## Prerequisites

Before running the ingestion script, ensure you have:

1. **Environment Variables**
   ```bash
   GOOGLE_GEMINI_API_KEY=your_api_key_here
   ```

2. **ChromaDB Running**
   ```bash
   # Default: http://localhost:8000
   docker run -p 8000:8000 chromadb/chroma
   ```

3. **Dependencies Installed**
   ```bash
   pnpm install
   ```

4. **Required Packages**
   - `chromadb` - Vector database client
   - `@google/genai` - Google Gemini API
   - `@chroma-core/google-gemini` - Gemini embedding function
   - `dotenv` - Environment variable management

---

## How to Run Ingestion

### 1. Basic Usage

```bash
# From project root
pnpm ts-node seed/seeder-pdf.ts
```

### 2. Expected Output

```
🚀 Starting PDF-based seeding process...
📄 Reading PDF from: .../backend_case_study_clean.pdf
✅ PDF loaded successfully (40365 bytes)
✅ Gemini client initialized

📋 Starting extraction of 4 sections...

🔍 Extracting section: Job Description...
✅ Successfully extracted Job Description
   Length: 850 characters

🔍 Extracting section: Case Study Brief...
✅ Successfully extracted Case Study Brief
   Length: 4722 characters

🔍 Extracting section: CV Scoring Rubric...
✅ Successfully extracted CV Scoring Rubric
   Length: 3596 characters

🔍 Extracting section: Project Scoring Rubric...
✅ Successfully extracted Project Scoring Rubric
   Length: 4558 characters

✅ All sections extracted successfully!

📦 Connecting to ChromaDB...
✅ Successfully connected to collection: ground_truth

💾 Upserting documents to ChromaDB...
✅ Seeding complete! Collection 'ground_truth' now has 4 documents.

📊 Summary:
   - Job Description: 850 chars
   - Case Study Brief: 4722 chars
   - CV Rubric: 3596 chars
   - Project Rubric: 4558 chars

🎉 Seeding process finished successfully!
```

### 3. Verify Data

After ingestion, run the test script to verify:

```bash
pnpm ts-node seed/test-chromadb.ts
```

---

## How It Works

### 1. PDF Reading

```typescript
const pdfBuffer = readFileSync(PDF_PATH);
```

The script reads the PDF file as a buffer for processing.

### 2. Multimodal AI Extraction

```typescript
const response = await gemini.models.generateContent({
  model: 'gemini-2.5-flash-lite',
  contents: [{
    role: 'user',
    parts: [
      {
        inlineData: {
          mimeType: 'application/pdf',
          data: pdfBuffer.toString('base64'),
        },
      },
      {
        text: prompt, // Specific extraction instructions
      },
    ],
  }],
  config: {
    temperature: 0.1, // Low for consistent results
  },
});
```

**Key Points:**
- Sends PDF as base64-encoded data to Gemini
- Uses specific prompts to extract only targeted sections
- Low temperature (0.1) ensures consistent extraction
- Model: `gemini-2.5-flash-lite` for fast processing

### 3. Section Validation

```typescript
function validateExtractedText(
  text: string,
  sectionName: string,
  maxChars: number = MAX_CHARS_PER_SECTION,
): void {
  if (text.length > maxChars) {
    throw new Error(`VALIDATION FAILED: ${sectionName} has ${text.length} characters...`);
  }
}
```

After each extraction, the script validates the character count to detect extraction failures.

### 4. ChromaDB Storage

```typescript
await collection.upsert({
  documents: [jobDescription, caseStudyBrief, rubricCv, rubricProject],
  metadatas: [
    { type: 'job_description', role: 'backend' },
    { type: 'case_study_brief', role: 'backend' },
    { type: 'rubric', for: 'cv', role: 'backend' },
    { type: 'rubric', for: 'project', role: 'backend' },
  ],
  ids: ['jd_backend_1', 'brief_backend_1', 'rubric_cv_backend_1', 'rubric_project_backend_1'],
});
```

Documents are stored with:
- **IDs**: Unique identifiers for retrieval
- **Metadata**: Structured tags for filtering (type, role, for)
- **Embeddings**: Automatically generated by GoogleGeminiEmbeddingFunction

---

## Validation Logic

### Character Limit: 15,000 Characters

```typescript
const MAX_CHARS_PER_SECTION = 15000;
```

**Why this limit?**

The validation exists to catch extraction failures early, before bad data is stored in ChromaDB.

#### Normal vs Invalid Extraction

| Section | Normal Range | Invalid Case (Bug) |
|---------|--------------|-------------------|
| Job Description | 500-6,000 chars | - |
| Case Study Brief | 3,000-8,000 chars | - |
| CV Rubric | 2,000-5,000 chars | 970 chars (too short) |
| Project Rubric | 3,000-6,000 chars | **2,031,439 chars** (2M+) |

**Real-world example**: When using a poorly structured PDF (142KB with 8 pages), the Project Rubric extraction failed and returned 2+ million characters instead of ~4,500. This validation prevents such data from being stored.

#### What happens on validation failure?

```
❌ VALIDATION FAILED: Project Scoring Rubric has 2,031,439 characters,
which exceeds the maximum allowed 15,000 characters.

This indicates an extraction failure. Please check:
1. PDF structure and formatting
2. Extraction prompts
3. Section boundaries in the PDF

Ingestion process aborted to prevent storing invalid data.
```

The script **throws an error** and **exits** before upserting to ChromaDB.

---

## Design Decisions

### 1. Why 15,000 characters as threshold?

**Context:**
- Typical rubric sections: 2,000-6,000 chars
- Job descriptions: 500-6,000 chars
- Case study briefs: 3,000-8,000 chars

**Decision:**
- 15,000 chars = ~2.5x the maximum normal size
- Provides buffer for legitimate long sections
- Catches catastrophic failures (2M+ chars)
- Low false-positive rate

**Alternative considered:** Dynamic thresholds per section type (rejected for simplicity).

### 2. Why validate per-section instead of at the end?

**Chosen approach:** Validate immediately after each extraction

**Reasoning:**
- **Fail fast**: Stop processing as soon as error detected
- **Clear error messages**: Know exactly which section failed
- **Save API costs**: Don't extract remaining sections if one fails
- **Debugging**: Easier to identify which prompt needs fixing

**Alternative considered:** Validate all at once after extraction (rejected - wastes API calls).

### 3. Why use Gemini multimodal instead of PDF parsers?

**Chosen approach:** Send PDF to Gemini with specific extraction prompts

**Advantages:**
- **Semantic understanding**: AI understands document structure, not just text
- **Flexible extraction**: Prompts can adapt to different PDF layouts
- **No preprocessing**: Works directly with PDF, no conversion needed
- **Quality results**: Better at identifying section boundaries

**Disadvantages:**
- **API costs**: Each extraction costs API tokens
- **Latency**: Network calls add processing time
- **Dependency**: Requires Gemini API access

**Alternatives considered:**
- `pdf-parse` library: Good for simple text extraction, struggles with complex layouts
- `pdfjs-dist`: Browser-focused, not ideal for server-side
- OCR + NLP: Overkill for already-digital PDFs

**Decision**: Gemini multimodal provides best balance of accuracy and simplicity.

### 4. Why require clean/well-structured PDFs?

**Observation:** PDF structure significantly impacts extraction quality

| PDF Type | Size | Extraction Quality |
|----------|------|-------------------|
| Original backend PDF | 142.8KB (8 pages) | FAILED (2M+ chars for rubric) |
| Clean backend PDF | 40.4KB (4 pages) | SUCCESS (850-4,722 chars) |
| Blockchain PDF | 46.5KB | SUCCESS |

**Requirements for clean PDFs:**
1. **Clear section headings**: Use consistent heading hierarchy (H1, H2, H3)
2. **Logical structure**: Each major section well-separated
3. **Minimal redundancy**: Remove submission templates, unnecessary appendices
4. **Concise content**: 4-6 pages maximum per role
5. **Simple formatting**: Avoid complex tables, nested lists

**Workflow:**
1. Write clean markdown with clear structure
2. Convert markdown to PDF manually
3. Run ingestion script
4. Verify with test script

**Decision**: Investing time in PDF preparation (5-10 mins) prevents extraction issues and ensures data quality.

### 5. Why use `upsert` instead of `add`?

**Chosen approach:** `collection.upsert()`

**Reasoning:**
- **Idempotent**: Can re-run script without errors
- **Updates**: Allows updating documents if content changes
- **No duplicates**: Same ID overwrites existing document

**Alternative:** `collection.add()` would fail on re-runs if IDs already exist.

---

## PDF Preparation Guide

### Best Practices for Creating Clean PDFs

1. **Start with Markdown**
   - Write content in markdown format
   - Use clear heading hierarchy
   - Keep structure simple and logical

2. **Document Structure**
   ```markdown
   # Role Name - Case Study

   ## Case Study Brief
   ### Objective
   ### Context/Background
   ### Deliverables
   ### Requirements

   ## Job Description
   ### About the Job
   ### Key Responsibilities
   ### About You

   ## CV Match Evaluation Rubric
   ### Parameter 1: Technical Skills (Weight: 40%)
   ### Parameter 2: Experience Level (Weight: 25%)
   ...

   ## Project Deliverable Evaluation Rubric
   ### Parameter 1: Correctness (Weight: 30%)
   ### Parameter 2: Code Quality (Weight: 25%)
   ...
   ```

3. **Content Guidelines**
   - Job Description: 500-6,000 characters
   - Case Study Brief: 3,000-8,000 characters
   - Each Rubric: 2,000-6,000 characters
   - Total document: 4-6 pages maximum

4. **Formatting Rules**
   - Use `##` for major sections
   - Use `###` for subsections
   - Keep paragraphs concise
   - Avoid deeply nested lists
   - No complex tables (simple tables OK)

5. **Convert to PDF**
   - Use tools like Typora, Marked, or Pandoc
   - Ensure headings are preserved
   - Verify visual structure before using

6. **Validation Checklist**
   - [ ] File size under 50KB
   - [ ] 4-6 pages maximum
   - [ ] Clear section boundaries
   - [ ] No submission templates or appendices
   - [ ] Headings follow hierarchy
   - [ ] Content is concise and relevant

---

## Troubleshooting

### Issue 1: Validation Error - Character Count Too High

```
❌ VALIDATION FAILED: Project Scoring Rubric has 50,000 characters
```

**Cause:** PDF structure is too complex or prompts are extracting wrong sections.

**Solutions:**
1. **Recreate PDF** from clean markdown
2. **Check section boundaries** - ensure clear separation
3. **Reduce content** - remove unnecessary text
4. **Verify prompts** - ensure they specify correct stop conditions

### Issue 2: Empty or Very Short Extraction

```
✅ Successfully extracted CV Scoring Rubric
   Length: 150 characters
```

**Cause:** Section not found or prompt too restrictive.

**Solutions:**
1. **Check section title** in PDF matches prompt expectations
2. **Verify headings** - use consistent naming (e.g., "CV Scoring Rubric" vs "CV Evaluation")
3. **Review prompt** in `seeder-pdf.ts` - may need adjustment
4. **Check PDF structure** - section may not be clearly separated

### Issue 3: ChromaDB Connection Error

```
Error: Failed to connect to ChromaDB
```

**Cause:** ChromaDB not running or wrong URL.

**Solutions:**
1. **Start ChromaDB**: `docker run -p 8000:8000 chromadb/chroma`
2. **Check URL**: Default is `http://localhost:8000`
3. **Verify port**: Ensure port 8000 is not in use

### Issue 4: Gemini API Error

```
Error: GOOGLE_GEMINI_API_KEY is not set
```

**Solutions:**
1. **Set environment variable** in `.env` file
2. **Verify API key** is valid and active
3. **Check quota** - ensure API quota not exceeded

### Issue 5: Wrong Sections Extracted

**Symptoms:** Content from wrong sections or mixed content.

**Solutions:**
1. **Improve PDF structure** - clearer section boundaries
2. **Update prompts** - be more specific about start/stop points
3. **Add section markers** - use horizontal rules (`---`) between sections in markdown
4. **Test with simpler PDF** - verify prompts work with minimal doc

---

## Metadata Schema

Documents in ChromaDB use the following metadata structure:

```typescript
{
  type: 'job_description' | 'case_study_brief' | 'rubric',
  role: 'backend' | 'blockchain' | 'frontend' | ...,
  for?: 'cv' | 'project',  // Only for rubrics
}
```

### Query Examples

```typescript
// Get backend job description
where: {
  type: 'job_description',
  role: 'backend'
}

// Get CV rubric for backend
where: {
  $and: [
    { type: 'rubric' },
    { for: 'cv' },
    { role: 'backend' }
  ]
}
```

---

## Document IDs Convention

Format: `{type}_{role}_{sequence}`

Examples:
- `jd_backend_1` - Job Description, Backend, #1
- `brief_backend_1` - Case Study Brief, Backend, #1
- `rubric_cv_backend_1` - CV Rubric, Backend, #1
- `rubric_project_backend_1` - Project Rubric, Backend, #1

**Note:** Sequence number allows for multiple versions/variations per role.

---

## Adding New Roles

To add a new role (e.g., Frontend, DevOps):

1. **Create clean PDF**
   - Follow PDF Preparation Guide
   - Name: `{role}_case_study.pdf`

2. **Update `seeder-pdf.ts`**
   ```typescript
   const PDF_PATH = join(__dirname, 'frontend_case_study.pdf');
   ```

3. **Update metadata**
   ```typescript
   metadatas: [
     { type: 'job_description', role: 'frontend' },
     { type: 'case_study_brief', role: 'frontend' },
     { type: 'rubric', for: 'cv', role: 'frontend' },
     { type: 'rubric', for: 'project', role: 'frontend' },
   ]
   ```

4. **Update IDs**
   ```typescript
   ids: [
     'jd_frontend_1',
     'brief_frontend_1',
     'rubric_cv_frontend_1',
     'rubric_project_frontend_1'
   ]
   ```

5. **Run ingestion**
   ```bash
   pnpm ts-node seed/seeder-pdf.ts
   ```

6. **Verify**
   ```bash
   pnpm ts-node seed/test-chromadb.ts
   ```

---

## Performance Considerations

- **Extraction time**: ~5-15 seconds per section (depends on PDF size and API latency)
- **Total ingestion**: ~30-60 seconds for 4 sections
- **API costs**: ~4 API calls per PDF (one per section)
- **ChromaDB storage**: Each document ~3-5KB in vector form

**Optimization tips:**
- Use `gemini-2.5-flash-lite` model (fast + cheap)
- Low temperature (0.1) for faster consistent results
- Clean PDFs reduce token usage

---

## Related Files

- **Application code**: `src/shared/chroma.service.ts` - Production service for querying ChromaDB
- **Evaluation logic**: `src/evaluate/` - Uses seeded data for CV/project evaluation
- **Schema**: `prisma/schema.prisma` - Database models for storing evaluation results

---

## License

Part of the AI-Powered Recruitment Assistant project.
