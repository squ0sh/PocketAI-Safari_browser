import { defineSecret, defineString } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import { handleAssist } from './assist.js';

const freeLlmApiUrl = defineSecret('FREELLM_API_URL');
const freeLlmApiKey = defineSecret('FREELLM_API_KEY');
const bonsaiModel = defineString('FREELLM_27B_MODEL', { default: '' });

export const onlineAssist = onRequest({
  region: 'us-central1', cors: true, secrets: [freeLlmApiUrl, freeLlmApiKey],
}, (request, response) => handleAssist(request, response, {
  url: () => freeLlmApiUrl.value(), key: () => freeLlmApiKey.value(),
  defaultModel: process.env.FREELLM_MODEL, bonsaiModel: bonsaiModel.value(),
}));
