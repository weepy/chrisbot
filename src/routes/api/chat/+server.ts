import { Configuration, OpenAIApi } from "openai";

import { OPENAI_KEY, PINECONE_KEY, PINECONE_ENV, OPENAI_ORG_ID } from '$env/static/private';
import type { CreateChatCompletionRequest, ChatCompletionRequestMessage } from 'openai';
import type { RequestHandler } from './$types';
import { getTokens } from '$lib/utils/tokenizer';
import { json } from '@sveltejs/kit';
import type { Config } from '@sveltejs/adapter-vercel';

// import 
const PROMPT_START = "You are Chris Bot. You are helping a user with their questions about startups. "
export const config: Config = {
  runtime: 'edge'
};



import { PineconeClient } from "@pinecone-database/pinecone";


async function initPineCone() {

  const pinecone = new PineconeClient()

  console.log("initing pinecone", PINECONE_ENV,PINECONE_KEY )
  try {
    await pinecone.init({

      environment: PINECONE_ENV,
      apiKey: PINECONE_KEY,
    })
  }
  catch(e) {
    console.log("error", e)  
  }

  console.log("done")
  return pinecone.Index("chat-dtgp");
  
}


  
const configuration = new Configuration({
  organization: OPENAI_ORG_ID,
  apiKey: OPENAI_KEY,
});
const openai = new OpenAIApi(configuration);

async function getContext(query) {

  const pinecone_index = await initPineCone()

  return "none"

  const res = await openai.createEmbedding({
    input: query,
    model: 'text-embedding-ada-002',
  });
  console.log(res.data.data[0].embedding)
  const xq = res.data.data[0].embedding;
  const result = await pinecone_index.query(
    { queryRequest: {

      topK: 3,

      includeMetadata: true,
      vector: xq,
    }
  })
    
  for (const match of result.matches) {
    console.log(`${match.score.toFixed(2)}: ${match.metadata.text}`);
  }

  return result.matches.map( x => x.metadata.text ).join("")
}

export const POST: RequestHandler = async ({ request }) => {

    

  

  try {
    if (!OPENAI_KEY) {
      throw new Error('OPENAI_KEY env variable not set');
    }

    const requestData = await request.json();

    if (!requestData) {
      throw new Error('No request data');
    }

    const reqMessages: ChatCompletionRequestMessage[] = requestData.messages;

    if (!reqMessages) {
      throw new Error('no messages provided');
    }


    const last = reqMessages.at(-1)

    // console.log(last.content)

    const context = await getContext(last.content)
    
    
    last.content = `
      Context: ${context}
      

      ${last.content}
    `





    let tokenCount = 0;

    reqMessages.forEach((msg) => {
      const tokens = getTokens(msg.content);
      tokenCount += tokens;
    })

    
    // const res = await openai.createEmbedding({
    //   input: query,
    //   model: 'text-embedding-ada-002',
    // });
    // const xq = res.data[0].embedding;
    // const result = await index.query({ xq }, { topK: 5, includeMetadata: true });
    // for (const match of result.matches) {
    //   console.log(`${match.score.toFixed(2)}: ${match.metadata.text}`);
    // }
    // const moderationRes = await fetch('https://api.openai.com/v1/moderations', {
    //   headers: {
    //     'Content-Type': 'application/json',
    //     Authorization: `Bearer ${OPENAI_KEY}`
    //   },
    //   method: 'POST',
    //   body: JSON.stringify({
    //     input: reqMessages[reqMessages.length - 1].content
    //   })
    // });

    // const moderationData = await moderationRes.json();
    // const [results] = moderationData.results;

    // if (results.flagged) {
    //   throw new Error('Query flagged by openai');
    // }
    
    const prompt = PROMPT_START
    tokenCount += getTokens(prompt);
    
    if (tokenCount >= 4000) {
      throw new Error('Query too large');
    }

    console.log("tokenCount", tokenCount)

    const messages: ChatCompletionRequestMessage[] = [
      { role: 'system', content: prompt },
      ...reqMessages
    ];

    const chatRequestOpts: CreateChatCompletionRequest = {
      model: 'gpt-3.5-turbo',
      messages,
      temperature: 0.9,
      stream: true
    };

    console.log(chatRequestOpts)

    const chatResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json'
      },
      method: 'POST',
      body: JSON.stringify(chatRequestOpts)
    });

    if (!chatResponse.ok) {
      const err = await chatResponse.json();
      throw new Error(err);
    }

    return new Response(chatResponse.body, {
      headers: {
        'Content-Type': 'text/event-stream'
      }
    });
  } catch (err) {
    console.error(err);
    return json({ error: 'There was an error processing your request' }, { status: 500 });
  }
};
