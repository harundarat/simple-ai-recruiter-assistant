import 'dotenv/config';
import { ChromaClient } from 'chromadb';
import { GoogleGeminiEmbeddingFunction } from '@chroma-core/google-gemini';

// ===================================================================
// CONFIGURATION
// ===================================================================

const COLLECTION_NAME = 'ground_truth';

interface DocumentResult {
  id: string;
  role: string;
  type: string;
  content: string;
  length: number;
  metadata: Record<string, any>;
}

// ===================================================================
// HELPER FUNCTIONS
// ===================================================================

function formatDocumentPreview(doc: DocumentResult): string {
  const preview = doc.content.substring(0, 150).replace(/\n/g, ' ');
  const status = doc.content.length > 0 ? '✅' : '❌';

  return `
${status} Document ID: ${doc.id}
   Role: ${doc.role}
   Type: ${doc.type}
   Length: ${doc.length} characters
   Preview: ${preview}...
`;
}

// ===================================================================
// TEST FUNCTIONS
// ===================================================================

async function testGetAllDocuments() {
  console.log('\n📋 TEST 1: Get All Documents by ID');
  console.log('='.repeat(60));

  const client = new ChromaClient();
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GOOGLE_GEMINI_API_KEY is not set in .env file');
  }

  const embeddingFunction = new GoogleGeminiEmbeddingFunction({ apiKey });

  const collection = await client.getOrCreateCollection({
    name: COLLECTION_NAME,
    embeddingFunction: embeddingFunction,
  });

  // Define all expected document IDs
  const documentIds = [
    // Backend documents
    'jd_backend_1',
    'brief_backend_1',
    'rubric_cv_backend_1',
    'rubric_project_backend_1',
    // Blockchain documents
    'jd_blockchain_1',
    'brief_blockchain_1',
    'rubric_cv_blockchain_1',
    'rubric_project_blockchain_1',
  ];

  const results = await collection.get({
    ids: documentIds,
    include: ['documents', 'metadatas'],
  });

  const documents: DocumentResult[] = [];

  for (let i = 0; i < results.ids.length; i++) {
    const doc: DocumentResult = {
      id: results.ids[i],
      role: (results.metadatas?.[i] as any)?.role || 'unknown',
      type: (results.metadatas?.[i] as any)?.type || 'unknown',
      content: results.documents?.[i] || '',
      length: results.documents?.[i]?.length || 0,
      metadata: results.metadatas?.[i] as Record<string, any> || {},
    };
    documents.push(doc);
    console.log(formatDocumentPreview(doc));
  }

  return documents;
}

async function testQueryByType() {
  console.log('\n🔍 TEST 2: Query by Document Type');
  console.log('='.repeat(60));

  const client = new ChromaClient();
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GOOGLE_GEMINI_API_KEY is not set in .env file');
  }

  const embeddingFunction = new GoogleGeminiEmbeddingFunction({ apiKey });

  const collection = await client.getOrCreateCollection({
    name: COLLECTION_NAME,
    embeddingFunction: embeddingFunction,
  });

  // Test 1: Query job descriptions
  console.log('\n📌 Querying: Job Descriptions (backend)');
  const jobDescResults = await collection.query({
    queryTexts: ['backend developer requirements skills'],
    nResults: 2,
    where: {
      $and: [
        { type: 'job_description' },
        { role: 'backend' },
      ],
    },
  });

  if (jobDescResults.documents[0] && jobDescResults.documents[0][0]) {
    const doc = jobDescResults.documents[0][0];
    console.log(`✅ Found: ${jobDescResults.ids[0]?.[0]}`);
    console.log(`   Length: ${doc.length} chars`);
    console.log(`   Preview: ${doc.substring(0, 100)}...`);
  } else {
    console.log('❌ Not found');
  }

  // Test 2: Query case study brief
  console.log('\n📌 Querying: Case Study Brief (backend)');
  const briefResults = await collection.query({
    queryTexts: ['case study brief project requirements deliverables'],
    nResults: 2,
    where: {
      $and: [
        { type: 'case_study_brief' },
        { role: 'backend' },
      ],
    },
  });

  if (briefResults.documents[0] && briefResults.documents[0][0]) {
    const doc = briefResults.documents[0][0];
    console.log(`✅ Found: ${briefResults.ids[0]?.[0]}`);
    console.log(`   Length: ${doc.length} chars`);
    console.log(`   Preview: ${doc.substring(0, 100)}...`);
  } else {
    console.log('❌ Not found');
  }

  // Test 3: Query CV rubric
  console.log('\n📌 Querying: CV Scoring Rubric (backend)');
  const cvRubricResults = await collection.query({
    queryTexts: ['cv evaluation scoring rubric parameters'],
    nResults: 2,
    where: {
      $and: [
        { type: 'rubric' },
        { for: 'cv' },
        { role: 'backend' },
      ],
    },
  });

  if (cvRubricResults.documents[0] && cvRubricResults.documents[0][0]) {
    const doc = cvRubricResults.documents[0][0];
    console.log(`✅ Found: ${cvRubricResults.ids[0]?.[0]}`);
    console.log(`   Length: ${doc.length} chars`);
    console.log(`   Preview: ${doc.substring(0, 100)}...`);
  } else {
    console.log('❌ Not found');
  }

  // Test 4: Query project rubric
  console.log('\n📌 Querying: Project Scoring Rubric (blockchain)');
  const projectRubricResults = await collection.query({
    queryTexts: ['project evaluation scoring rubric parameters'],
    nResults: 2,
    where: {
      $and: [
        { type: 'rubric' },
        { for: 'project' },
        { role: 'blockchain' },
      ],
    },
  });

  if (projectRubricResults.documents[0] && projectRubricResults.documents[0][0]) {
    const doc = projectRubricResults.documents[0][0];
    console.log(`✅ Found: ${projectRubricResults.ids[0]?.[0]}`);
    console.log(`   Length: ${doc.length} chars`);
    console.log(`   Preview: ${doc.substring(0, 100)}...`);
  } else {
    console.log('❌ Not found');
  }
}

async function testCollectionStats() {
  console.log('\n📊 TEST 3: Collection Statistics');
  console.log('='.repeat(60));

  const client = new ChromaClient();
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GOOGLE_GEMINI_API_KEY is not set in .env file');
  }

  const embeddingFunction = new GoogleGeminiEmbeddingFunction({ apiKey });

  const collection = await client.getOrCreateCollection({
    name: COLLECTION_NAME,
    embeddingFunction: embeddingFunction,
  });

  const count = await collection.count();
  console.log(`\n📦 Total Documents: ${count}`);

  // Get all documents to analyze
  const allDocs = await collection.get({
    include: ['metadatas'],
  });

  // Group by role
  const byRole: Record<string, number> = {};
  const byType: Record<string, number> = {};

  for (const metadata of allDocs.metadatas || []) {
    const meta = metadata as any;
    const role = meta?.role || 'unknown';
    const type = meta?.type || 'unknown';

    byRole[role] = (byRole[role] || 0) + 1;
    byType[type] = (byType[type] || 0) + 1;
  }

  console.log('\n📋 Documents by Role:');
  Object.entries(byRole).forEach(([role, count]) => {
    console.log(`   ${role}: ${count} documents`);
  });

  console.log('\n📋 Documents by Type:');
  Object.entries(byType).forEach(([type, count]) => {
    console.log(`   ${type}: ${count} documents`);
  });

  return { count, byRole, byType };
}

// ===================================================================
// MAIN TEST RUNNER
// ===================================================================

async function runTests() {
  try {
    console.log('🚀 Starting ChromaDB Test Suite');
    console.log('='.repeat(60));

    // Test 1: Get all documents
    const documents = await testGetAllDocuments();

    // Test 2: Query by type
    await testQueryByType();

    // Test 3: Collection stats
    const stats = await testCollectionStats();

    // Summary
    console.log('\n\n✨ TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Documents Retrieved: ${documents.length}`);
    console.log(`✅ Total Collection Size: ${stats.count} documents`);
    console.log(`✅ Backend Documents: ${stats.byRole.backend || 0}`);
    console.log(`✅ Blockchain Documents: ${stats.byRole.blockchain || 0}`);

    const validDocs = documents.filter(d => d.length > 500);
    console.log(`\n📊 Data Quality:`);
    console.log(`   Valid documents (>500 chars): ${validDocs.length}/${documents.length}`);
    console.log(`   Average length: ${Math.round(documents.reduce((sum, d) => sum + d.length, 0) / documents.length)} chars`);

    console.log('\n🎉 All tests completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    process.exit(1);
  }
}

// Run tests
runTests();
