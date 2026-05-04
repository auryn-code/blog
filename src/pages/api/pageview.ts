import type { APIRoute } from 'astro'
import { MongoClient } from 'mongodb'

const DB_NAME = 'twikoo'
const COLLECTION_NAME = 'pageviews'

export const POST: APIRoute = async ({ request }) => {
  const MONGODB_URI = process.env.MONGODB_URI || ''

  if (!MONGODB_URI) {
    return new Response(
      JSON.stringify({ error: 'MONGODB_URI environment variable is not set', count: 0 }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  if (!MONGODB_URI) {
    const { url } = await request.json() as { url: string }
    // 返回随机模拟浏览量
    const mockCount = Math.floor(Math.random() * 100) + 1
    return new Response(
      JSON.stringify({ url, count: mockCount }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    const { url } = await request.json() as { url: string }
    
    if (!url) {
      return new Response(
        JSON.stringify({ error: 'url is required', count: 0 }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const client = new MongoClient(MONGODB_URI)
    
    try {
      await client.connect()
      const db = client.db(DB_NAME)
      const collection = db.collection(COLLECTION_NAME)

      // 增加访问计数
      const result = await collection.findOneAndUpdate(
        { url },
        {
          $inc: { count: 1 },
          $set: { url, updatedAt: new Date() },
          $setOnInsert: { createdAt: new Date() }
        },
        { upsert: true, returnDocument: 'after' }
      )

      const count = result.value?.count || 1

      return new Response(
        JSON.stringify({ url, count }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    } finally {
      await client.close()
    }
  } catch (error) {
    console.error('Error in pageview API:', error)
    return new Response(
      JSON.stringify({ error: String(error), count: 0 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
