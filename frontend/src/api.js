import axios from "axios";

// Read API base from Vite env, fallback to localhost
const BASE = (import.meta.env.VITE_API_BASE || "http://localhost:5000/api").replace(/\/+$/, "");

export async function getToken(userId="user123"){
  const res = await axios.post(`${BASE}/token`, { userId });
  return res.data;
}
export async function createTransaction(payload){
  const res = await axios.post(`${BASE}/transactions`, payload);
  return res.data;
}
export async function getTxStatus(txId, txToken=null){
  const headers = {};
  if (txToken) headers.Authorization = `Bearer ${txToken}`;
  return axios.get(`${BASE}/transactions/${txId}/status`, { headers }).then(r => r.data);
}
export async function posPending(token){
  const headers = { Authorization: `Bearer ${token}` };
  const res = await axios.get(`${BASE}/transactions/pending`, { headers });
  return res.data;
}
export async function posReady(token){
  const headers = { Authorization: `Bearer ${token}` };
  const res = await axios.get(`${BASE}/transactions/ready`, { headers });
  return res.data;
}
export async function posConfirm(txId, token){
  const headers = { Authorization: `Bearer ${token}` };
  const res = await axios.post(`${BASE}/transactions/${txId}/pos-confirm`, {}, { headers });
  return res.data;
}
export async function authorizeTx(txId, token){
  const headers = { Authorization: `Bearer ${token}` };
  const res = await axios.post(`${BASE}/transactions/${txId}/authorize`, {}, { headers });
  return res.data;
}
export async function clearTx(txId){
  return axios.post(`${BASE}/transactions/${txId}/clear`);
}
