import React, { useEffect, useState, useRef } from "react";
import * as api from "./api";

export default function App(){
  const [serverToken, setServerToken] = useState(null); // POS token (role=pos)
  const [txToken, setTxToken] = useState(null); // tx token returned for polling
  const [txId, setTxId] = useState(null);
  const [grandTotal, setGrandTotal] = useState(null);
  const [status, setStatus] = useState("");
  const [polling, setPolling] = useState(false);
  const [pendingList, setPendingList] = useState([]);
  const [readyList, setReadyList] = useState([]);
  const [imageUrl, setImageUrl] = useState(null);
  const [error, setError] = useState("");
  const [view, setView] = useState("both"); // 'client' | 'pos' | 'both'

  // form inputs
  const [source, setSource] = useState("mobile:device-123");
  const [destination, setDestination] = useState("pos:terminal-9");
  const [amount, setAmount] = useState(1000);
  const [buyerFloatPercent, setBuyerFloatPercent] = useState(2.5);
  const [ttlExpiresAt, setTtlExpiresAt] = useState(null);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const pollIntervalRef = useRef(null);

  useEffect(()=>{ // get POS token (role=pos)
    async function t(){ 
      try {
        const { token } = await api.getToken("pos-server", "pos"); 
        setServerToken(token);
      } catch (e) {
        console.error(e);
        setError("Failed to get POS server token");
      }
    }
    t();
  },[]);

  async function refreshPosToken(){
    try {
      const { token } = await api.getToken("pos-server", "pos");
      setServerToken(token);
      setError("");
    } catch (e) {
      console.error(e);
      setError("Failed to refresh POS token");
    }
  }

  // Mobile: create transaction -> enters WAITING state and returns txToken & imageUrl
  async function createTransaction(){
    setError("");
    try {
      setStatus("Requesting token (mobile) ...");
      const t = await api.getToken("mobile-user", "client"); // client role
      const mobileToken = t.token;
      setStatus("Creating transaction on server...");
      const payload = {
        token: mobileToken,
        source: source.trim(),
        destination: destination.trim(),
        amount: typeof amount === "string" ? parseFloat(amount) : amount,
        buyerFloatPercent: typeof buyerFloatPercent === "string" ? parseFloat(buyerFloatPercent) : buyerFloatPercent,
      };
      const res = await api.createTransaction(payload);
      setTxId(res.txId);
      setTxToken(res.txToken);
      setGrandTotal(res.grandTotal);
      setImageUrl(res.imageUrl);
      setStatus(`Transaction created: ${res.txId}`);
      const expires = Date.now() + (res.ttlSeconds || 300) * 1000;
      setTtlExpiresAt(expires);
      startPolling(res.txId, res.txToken, expires);
    } catch (e) {
      console.error(e);
      setError(e?.response?.data?.error || "Failed to create transaction");
      setStatus("Error creating transaction");
    }
  }

  // Poll a tx until READY_FOR_AUTH or AUTHORIZED
  function startPolling(id, token, expiresAtMs){
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    setPolling(true);
    pollIntervalRef.current = setInterval(async ()=>{
      try{
        if (expiresAtMs && Date.now() > expiresAtMs){
          clearInterval(pollIntervalRef.current);
          setPolling(false);
          setStatus("Polling stopped - token expired");
          return;
        }
        const res = await api.getTxStatus(id, token);
        const tx = res.tx;
        setStatus(`Polled status: ${tx.status}`);
        setGrandTotal(tx.grandTotal);
        setImageUrl(tx.imageUrl);
        if (tx.status === "READY_FOR_AUTH" || tx.status === "AUTHORIZED" || tx.status === "SETTLED"){
          clearInterval(pollIntervalRef.current);
          setPolling(false);
        }
      }catch(err){
        console.error(err);
        clearInterval(pollIntervalRef.current);
        setPolling(false);
        setStatus("Polling stopped - error");
        setError(err?.response?.data?.error || "Polling failed");
      }
    }, 2000);
  }

  // POS: list pending transactions (inverse polling)
  async function loadPending(){
    if (!serverToken) return alert("POS token not ready (role=pos)");
    try {
      const res = await api.posPending(serverToken);
      setPendingList(res.transactions || []);
    } catch (e) {
      console.error(e);
      setError(e?.response?.data?.error || "Failed to load pending transactions");
    }
  }

  // POS: list READY_FOR_AUTH transactions
  async function loadReady(){
    if (!serverToken) return alert("POS token not ready (role=pos)");
    try {
      const res = await api.posReady(serverToken);
      setReadyList(res.transactions || []);
    } catch (e) {
      console.error(e);
      setError(e?.response?.data?.error || "Failed to load ready transactions");
    }
  }

  // POS: confirm a tx (merchant clicks confirm on POS)
  async function confirmOnPos(txIdToConfirm){
    if (!serverToken) return alert("POS token not ready (role=pos)");
    try {
      await api.posConfirm(txIdToConfirm, serverToken);
      setStatus("POS confirmed tx -> READY_FOR_AUTH");
      await loadPending();
      await loadReady();
    } catch (e) {
      console.error(e);
      setError(e?.response?.data?.error || "Failed to confirm transaction on POS");
    }
  }

  // POS: authorize (simulate card authorization)
  async function authorizeOnPos(txIdToAuth){
    if (!serverToken) return alert("POS token not ready (role=pos)");
    try {
      const statusCheck = await api.getTxStatus(txIdToAuth, serverToken);
      if (statusCheck?.tx?.status !== "READY_FOR_AUTH"){
        setError(`Cannot authorize: current status is ${statusCheck?.tx?.status}. Confirm first.`);
        return;
      }
      await api.authorizeTx(txIdToAuth, serverToken);
      setStatus("Tx authorized and settled");
      await loadPending();
      await loadReady();
    } catch (e) {
      console.error(e);
      setError(e?.response?.data?.error || "Failed to authorize transaction");
    }
  }

  function printReceipt(){
    const html = `<div><h2>Receipt</h2><p>TX: ${txId}</p><p>Amount: ${grandTotal}</p></div>`;
    const w = window.open("", "_blank", "width=400,height=600");
    w.document.write(html);
    w.document.close();
    w.print();
  }

  async function cls(clearServer=false){
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    setTxId(null); setTxToken(null); setGrandTotal(null); setStatus(""); setImageUrl(null);
    setError("");
    setPolling(false);
    if (clearServer && txId) await api.clearTx(txId);
  }

  async function openImagePiP(){
    if (!imageUrl) return alert("No image available");
    let canvas = canvasRef.current;
    if (!canvas){
      canvas = document.createElement("canvas");
      canvasRef.current = canvas;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imageUrl;
    img.onload = async () => {
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const stream = canvas.captureStream(10);
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      try{
        await video.play();
        if (document.pictureInPictureEnabled) {
          await video.requestPictureInPicture();
        } else {
          alert("Picture-in-Picture not supported in this browser");
        }
      }catch(e){
        console.error("PiP error:", e);
      }
    };
  }

  const posReady = Boolean(serverToken);

  return (
    <div className="container">
      <h1>Polling task demo (Mobile ↔ POS)</h1>

      {/* Role Status & Switcher */}
      <div className="card small" style={{display:"flex",justifyContent:"space-between",alignItems:"center", gap:12}}>
        <div>
          <strong>Roles in this page</strong>
          <div className="small">Toggle which view to show and refresh POS token if needed.</div>
          <div className="row" style={{marginTop:8}}>
            <button className={view==="client"?"":"secondary"} onClick={()=>setView("client")}>Show Customer</button>
            <button className={view==="pos"?"":"secondary"} onClick={()=>setView("pos")}>Show Cashier</button>
            <button className={view==="both"?"":"secondary"} onClick={()=>setView("both")}>Show Both</button>
            <button onClick={refreshPosToken} title="Fetch a fresh POS (role=pos) token">Refresh POS Token</button>
            <button className="secondary" onClick={()=>setError("")}>Clear Errors</button>
          </div>
        </div>
        <div style={{display:"flex", gap:8, alignItems:"center"}}>
          <span className={`badge ${posReady?"badge-ready":""}`}>POS (role=pos): {posReady?"Ready":"Not ready"}</span>
          <span className="badge">Mobile (role=client): token requested on Start Transaction</span>
        </div>
      </div>

      {/* Quick Start / Onboarding */}
      <div className="card small" style={{background:"#f8fafc"}}>
        <h4>Quick Start (3 steps)</h4>
        <ol className="small" style={{marginTop:8}}>
          <li><strong>Customer</strong> (client role): set fields below, click <strong>Start Transaction</strong>.</li>
          <li><strong>Cashier</strong> (pos role): click <strong>Load Pending</strong>, then <strong>POS Confirm</strong>.</li>
          <li>Cashier: click <strong>Load Ready</strong>, then <strong>Authorize & Settle</strong>.</li>
        </ol>
      </div>

      {(view === "client" || view === "both") && (
      <div className="card">
        <h3>Customer (client role) — Mobile UI</h3>
        <div className="row" style={{gap:8, alignItems:"center", marginBottom:8}}>
          <label className="small">Source
            <input aria-label="source" list="source-options" type="text" value={source} onChange={e=>setSource(e.target.value)} placeholder="e.g. mobile:device-123" />
          </label>
          <label className="small">Destination
            <input aria-label="destination" list="destination-options" type="text" value={destination} onChange={e=>setDestination(e.target.value)} placeholder="e.g. pos:terminal-9" />
          </label>
          <label className="small">Amount
            <input aria-label="amount" list="amount-options" type="number" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="e.g. 1000" min="0" step="0.01" />
          </label>
          <label className="small">Buyer Float %
            <input aria-label="buyer-float" list="bfp-options" type="number" value={buyerFloatPercent} onChange={e=>setBuyerFloatPercent(e.target.value)} placeholder="e.g. 2.5" min="0" step="0.1" />
          </label>
        </div>
        <div className="row">
          <button title="Create a new transaction and start polling" onClick={createTransaction}>Start Transaction (Mobile)</button>
          <button title="Resume polling the existing transaction" onClick={()=>{ if (txId) startPolling(txId, txToken, ttlExpiresAt); }} className="secondary">Restart Poll</button>
          <button title="Clear the UI state" onClick={()=>cls(false)} className="secondary">CLS (clear UI)</button>
          <button title="Clear UI and delete the transaction on the server" onClick={()=>cls(true)} className="secondary">CLS + Clear Server</button>
        </div>
        <div className="small" style={{marginTop:6}}>
          <strong>Status legend:</strong> WAITING (created) → READY_FOR_AUTH (POS confirmed) → AUTHORIZED → SETTLED
        </div>
        <p className="small">Status: {status}</p>
        {error && <p className="small" style={{color:"#b00020"}}>Error: {error}</p>}
        <p className="small">TX: {txId}</p>
        <p className="small">Grand Total: {grandTotal}</p>
        <div className="video-wrap">
          <div>
            <video ref={videoRef} width="320" height="180" muted style={{border:"1px solid #ddd", background:"#000"}}></video>
            <div style={{marginTop:8}}>
              <button title="Open the preview image in Picture-in-Picture" onClick={openImagePiP}>Open Image in PiP</button>
              <button title="Print a simple receipt for this transaction" onClick={printReceipt} style={{marginLeft:8}}>Print Receipt</button>
            </div>
          </div>
          <div>
            {imageUrl && <img src={imageUrl} width="240" alt="preview" style={{border:"1px solid #eee"}} />}
            {!imageUrl && <div className="small">No image yet (create a new transaction)</div>}
          </div>
        </div>

        {/* Datalists */}
        <datalist id="source-options">
          <option value="mobile:device-123" />
          <option value="mobile:device-124" />
          <option value="mobile:device-125" />
          <option value="web:browser-1" />
        </datalist>
        <datalist id="destination-options">
          <option value="pos:terminal-1" />
          <option value="pos:terminal-5" />
          <option value="pos:terminal-9" />
          <option value="pos:kiosk-2" />
        </datalist>
        <datalist id="amount-options">
          <option value="10" />
          <option value="50" />
          <option value="100" />
          <option value="500" />
          <option value="1000" />
        </datalist>
        <datalist id="bfp-options">
          <option value="0" />
          <option value="1" />
          <option value="2.5" />
          <option value="5" />
        </datalist>
      </div>
      )}

      {(view === "pos" || view === "both") && (
      <div className="card">
        <h3>Cashier (pos role) — POS UI</h3>
        <div className="row">
          <button title="Fetch WAITING transactions from server" onClick={loadPending} disabled={!posReady}>Load Pending (POS poll)</button>
          <button title="Fetch READY_FOR_AUTH transactions from server" onClick={loadReady} className="secondary" disabled={!posReady}>Load Ready (Authorize)</button>
        </div>
        {!posReady && <p className="small">POS token is not ready yet. Use Refresh POS Token above, then try again.</p>}
        <div>
          {pendingList.length === 0 && <p className="small">No pending transactions</p>}
          <ul>
            {pendingList.map(tx => (
              <li key={tx._id}>
                <div><strong>{tx._id}</strong> — {tx.source} → {tx.destination} | Amount: {tx.amount} | Total: {tx.grandTotal} <span className="small" style={{marginLeft:8}}>(status: {tx.status})</span></div>
                <div style={{marginTop:6}}>
                  <button title="Move WAITING → READY_FOR_AUTH" onClick={()=>confirmOnPos(tx._id)} disabled={!posReady}>POS Confirm (Ready for Auth)</button>
                  <button title="Authorize the transaction (requires READY_FOR_AUTH)" onClick={()=>authorizeOnPos(tx._id)} className="secondary" style={{marginLeft:6}} disabled={!posReady || tx.status === "WAITING"}>Authorize & Settle</button>
                </div>
              </li>
            ))}
          </ul>
          <hr />
          <h4>POS Ready (authorize)</h4>
          {readyList.length === 0 && <p className="small">No READY_FOR_AUTH transactions</p>}
          <ul>
            {readyList.map(tx => (
              <li key={tx._id}>
                <div><strong>{tx._id}</strong> — {tx.source} → {tx.destination} | Amount: {tx.amount} | Total: {tx.grandTotal} <span className="small badge badge-ready">READY_FOR_AUTH</span></div>
                <div style={{marginTop:6}}>
                  <button onClick={()=>authorizeOnPos(tx._id)} disabled={!posReady}>Authorize & Settle</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
      )}

      <div className="card small">
        <h4>Developer notes</h4>
        <p>Client role (customer) is used when starting a transaction; POS role (cashier) is used for pending/ready/confirm/authorize.</p>
        <p>API Base: set <code>VITE_API_BASE</code> in <code>frontend/.env</code> (e.g. http://localhost:5000/api). Default is localhost:5000.</p>
      </div>
    </div>
  );
}
