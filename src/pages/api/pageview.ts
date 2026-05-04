import type { APIRoute } from 'astro'
import { MongoClient } from 'mongodb'

const MONGODB_URI = process.env.MONGODB_URI || ''
const DB_NAME = 'twikoo'
const COLLECTION_NAME = 'pageviews'

if (!MONGODB_URI) {
  throw new Error('MONGODB_URI environment variable is not set')
}

export const POST: APIRoute = async ({ request }) => {
  // 开发环境：不依赖 MongoDB，返回模拟数据
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
