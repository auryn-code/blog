import type { APIRoute } from 'astro'
import { MongoClient } from 'mongodb'

const DB_NAME = process.env.MONGODB_DB || 'twikoo'
const COLLECTION_NAME = 'pageviews'

declare global {
  // eslint-disable-next-line no-var
  var __aurrellPageviewClient: Promise<MongoClient> | undefined
}

function normalizePath(url: string) {
  try {
    const parsedUrl = new URL(url, 'https://aurrell.local')
    return parsedUrl.pathname.replace(/\/$/, '') || '/'
  } catch {
    return url.replace(/\/$/, '') || '/'
  }
}

function getClient(uri: string) {
  globalThis.__aurrellPageviewClient ??= new MongoClient(uri).connect()
  return globalThis.__aurrellPageviewClient
}

export const POST: APIRoute = async ({ request }) => {
  const MONGODB_URI = process.env.MONGODB_URI || ''

  if (!MONGODB_URI) {
    return new Response(
      JSON.stringify({ error: 'MONGODB_URI environment variable is not set', count: 0 }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    const { url, title } = await request.json() as { url: string; title?: string }
    
    if (!url) {
      return new Response(
        JSON.stringify({ error: 'url is required', count: 0 }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const normalizedUrl = normalizePath(url)
    const client = await getClient(MONGODB_URI)
    const db = client.db(DB_NAME)
    const collection = db.collection(COLLECTION_NAME)

    const now = new Date()
    const result = await collection.findOneAndUpdate(
      { url: normalizedUrl },
      {
        $inc: { count: 1 },
        $set: { url: normalizedUrl, title: title || normalizedUrl, updatedAt: now },
        $setOnInsert: { createdAt: now }
      },
      { upsert: true, returnDocument: 'after' }
    )

    const count = result?.count ?? 1

    return new Response(
      JSON.stringify({ url: normalizedUrl, count }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  } catch (error) {
    console.error('Error in pageview API:', error)
    return new Response(
      JSON.stringify({ error: String(error), count: 0 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
