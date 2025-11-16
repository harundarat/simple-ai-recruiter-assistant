import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { GoogleGenAI } from '@google/genai';
import { GoogleGeminiEmbeddingFunction } from '@chroma-core/google-gemini';
import { ChromaClient, Collection } from 'chromadb';

// ===================================================================
// 1. SETUP & CONFIGURATION
// ===================================================================

const PDF_PATH = join(__dirname, 'backend_case_study_clean.pdf');
const COLLECTION_NAME = 'ground_truth';

// Maximum allowed characters per section (to detect extraction failures)
const MAX_CHARS_PER_SECTION = 15000;

// ===================================================================
// 2. FUNGSI EKSTRAKSI SECTION DARI PDF MENGGUNAKAN GEMINI
// ===================================================================

async function extractSection(
  gemini: GoogleGenAI,
  pdfBuffer: Buffer,
  sectionName: string,
  prompt: string,
): Promise<string> {
  console.log(`\n🔍 Extracting section: ${sectionName}...`);

  const response = await gemini.models.generateContent({
    model: 'gemini-2.5-flash-lite',
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: pdfBuffer.toString('base64'),
            },
          },
          {
            text: prompt,
          },
        ],
      },
    ],
    config: {
      temperature: 0.1, // Low temperature untuk hasil yang konsisten
    },
  });

  const extractedText = response.text;

  if (!extractedText) {
    throw new Error(
      `Failed to extract ${sectionName}: No text returned from Gemini`,
    );
  }

  console.log(`✅ Successfully extracted ${sectionName}`);
  console.log(`   Length: ${extractedText.length} characters`);

  return extractedText;
}

// ===================================================================
// 2b. FUNGSI VALIDASI EXTRACTED TEXT
// ===================================================================

function validateExtractedText(
  text: string,
  sectionName: string,
  maxChars: number = MAX_CHARS_PER_SECTION,
): void {
  if (text.length > maxChars) {
    throw new Error(
      `❌ VALIDATION FAILED: ${sectionName} has ${text.length.toLocaleString()} characters, ` +
      `which exceeds the maximum allowed ${maxChars.toLocaleString()} characters.\n\n` +
      `This indicates an extraction failure. Please check:\n` +
      `1. PDF structure and formatting\n` +
      `2. Extraction prompts\n` +
      `3. Section boundaries in the PDF\n\n` +
      `Ingestion process aborted to prevent storing invalid data.`,
    );
  }
}

// ===================================================================
// 3. FUNGSI KONEKSI KE CHROMADB
// ===================================================================

async function getCollection(collectionName: string): Promise<Collection> {
  const client = new ChromaClient();
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GOOGLE_GEMINI_API_KEY is not set in .env file');
  }

  const embeddingFunction = new GoogleGeminiEmbeddingFunction({ apiKey });

  const collection = await client.getOrCreateCollection({
    name: collectionName,
    embeddingFunction: embeddingFunction,
  });

  console.log(`✅ Successfully connected to collection: ${collectionName}`);
  return collection;
}

// ===================================================================
// 4. FUNGSI UTAMA SEEDING
// ===================================================================

async function seed() {
  try {
    console.log('🚀 Starting PDF-based seeding process...');
    console.log(`📄 Reading PDF from: ${PDF_PATH}`);

    // Baca file PDF
    const pdfBuffer = readFileSync(PDF_PATH);
    console.log(`✅ PDF loaded successfully (${pdfBuffer.length} bytes)`);

    // Setup Gemini client
    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_GEMINI_API_KEY is not set in .env file');
    }

    const gemini = new GoogleGenAI({ apiKey });
    console.log('✅ Gemini client initialized');

    // Ekstrak 4 section dari PDF
    console.log('\n📋 Starting extraction of 4 sections...');

    // 1. Job Description
    const jobDescription = await extractSection(
      gemini,
      pdfBuffer,
      'Job Description',
      `Extract ONLY the "Job Description" section from this PDF.

Instructions:
1. Find the section titled "Job Description" (may include role name and year)
2. Extract from the title through all job-related subsections (About the Job, Requirements, Benefits, etc.)
3. STOP when you reach a different major section (e.g., "Case Study", "Evaluation", etc.)
4. DO NOT include content from other sections
5. Return ONLY the job description text, no commentary

Keep the original formatting and text as-is.`,
    );
    validateExtractedText(jobDescription, 'Job Description');

    // 2. Case Study Brief
    const caseStudyBrief = await extractSection(
      gemini,
      pdfBuffer,
      'Case Study Brief',
      `Extract ONLY the "Case Study Brief" section from this PDF.

Instructions:
1. Find the section titled "Case Study Brief" or similar
2. Extract from the title through all case study subsections (Objective, Context, Deliverables, Requirements, etc.)
3. STOP when you reach evaluation rubrics or a different major section
4. DO NOT include rubric tables or other sections
5. Return ONLY the case study brief text, no commentary

Keep the original formatting and text as-is.`,
    );
    validateExtractedText(caseStudyBrief, 'Case Study Brief');

    // 3. CV Scoring Rubric
    const rubricCv = await extractSection(
      gemini,
      pdfBuffer,
      'CV Scoring Rubric',
      `Extract ONLY the CV evaluation rubric table from this PDF.

Instructions:
1. Find the CV evaluation rubric (may be titled "CV Match Evaluation", "CV Evaluation", or similar)
2. Extract ONLY the rubric table with parameters, weights, descriptions, and scoring guides
3. Include typical parameters like: Technical Skills Match, Experience Level, Achievements, etc.
4. STOP after the last parameter in the CV rubric
5. DO NOT include the Project rubric or any other content
6. Expected output should be around 2000-10000 characters maximum

Return only the rubric table structure, no additional commentary.`,
    );
    validateExtractedText(rubricCv, 'CV Scoring Rubric');

    // 4. Project Scoring Rubric
    const rubricProject = await extractSection(
      gemini,
      pdfBuffer,
      'Project Scoring Rubric',
      `Extract ONLY the Project evaluation rubric table from this PDF.

Instructions:
1. Find the Project evaluation rubric (may be titled "Project Deliverable Evaluation", "Project Evaluation", or similar)
2. Extract ONLY the rubric table with parameters, weights, descriptions, and scoring guides
3. Include typical parameters like: Correctness, Code Quality, Error Handling, Documentation, etc.
4. STOP after the last parameter in the Project rubric
5. DO NOT include CV rubric, appendices, or any other content
6. Expected output should be around 2000-10000 characters maximum

Return only the rubric table structure, no additional commentary.`,
    );
    validateExtractedText(rubricProject, 'Project Scoring Rubric');

    console.log('\n✅ All sections extracted successfully!');

    // Connect ke ChromaDB
    console.log('\n📦 Connecting to ChromaDB...');
    const collection = await getCollection(COLLECTION_NAME);

    // Upsert documents ke ChromaDB
    console.log('\n💾 Upserting documents to ChromaDB...');
    await collection.upsert({
      documents: [jobDescription, caseStudyBrief, rubricCv, rubricProject],
      metadatas: [
        // Metadata untuk Job Description
        { type: 'job_description', role: 'backend' },

        // Metadata untuk Case Study Brief
        { type: 'case_study_brief', role: 'backend' },

        // Metadata untuk CV Rubric
        { type: 'rubric', for: 'cv', role: 'backend' },

        // Metadata untuk Project Rubric
        { type: 'rubric', for: 'project', role: 'backend' },
      ],
      ids: ['jd_backend_1', 'brief_backend_1', 'rubric_cv_backend_1', 'rubric_project_backend_1'],
    });

    // Verify
    const count = await collection.count();
    console.log(
      `\n✅ Seeding complete! Collection '${COLLECTION_NAME}' now has ${count} documents.`,
    );

    // Show summary
    console.log('\n📊 Summary:');
    console.log(`   - Job Description: ${jobDescription.length} chars`);
    console.log(`   - Case Study Brief: ${caseStudyBrief.length} chars`);
    console.log(`   - CV Rubric: ${rubricCv.length} chars`);
    console.log(`   - Project Rubric: ${rubricProject.length} chars`);
  } catch (error) {
    console.error('\n❌ Seeding failed:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    process.exit(1);
  }
}

// ===================================================================
// 5. EKSEKUSI SKRIP
// ===================================================================

seed()
  .then(() => {
    console.log('\n🎉 Seeding process finished successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Fatal error:', error);
    process.exit(1);
  });
