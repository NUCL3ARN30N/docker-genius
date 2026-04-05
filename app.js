var React = window.React;
var ReactDOM = window.ReactDOM;
var useState = React.useState;
var useEffect = React.useEffect;
var useRef = React.useRef;
var useCallback = React.useCallback;
var useMemo = React.useMemo;
var createContext = React.createContext;
var useContext = React.useContext;

// -- Icons --
var ICONS = {
  dashboard:"ri-dashboard-3-line", containers:"ri-instance-line", images:"ri-stack-line",
  volumes:"ri-database-2-line", networks:"ri-share-line", console:"ri-terminal-box-line",
  connections:"ri-plug-line", play:"ri-play-fill", stop:"ri-stop-fill",
  restart:"ri-restart-line", trash:"ri-delete-bin-6-line", log:"ri-file-text-line",
  search:"ri-search-line", plus:"ri-add-line", close:"ri-close-line",
  refresh:"ri-refresh-line", download:"ri-download-2-line", pause:"ri-pause-fill",
  info:"ri-information-line", eye:"ri-eye-line", github:"ri-github-fill",
  settings:"ri-settings-3-line", ship:"ri-ship-2-line", check:"ri-check-line",
  unpause:"ri-play-circle-line", prune:"ri-eraser-line", warn:"ri-error-warning-line",
  deploy:"ri-rocket-2-line", hub:"ri-cloud-line", compose:"ri-file-code-line",
  star:"ri-star-fill", upload:"ri-upload-2-line", backup:"ri-save-3-line",
  restore:"ri-folder-received-line",
};
function Icon(p) { return <i className={ICONS[p.name] || p.name} />; }

// -- Docker API --
class DockerAPI {
  constructor(ep) { this.ep = (ep || "").replace(/\/+$/, ""); }
  _fetch(path, opts) {
    var o = opts || {};
    return fetch(this.ep + path, Object.assign({}, o, {
      headers: Object.assign({"Content-Type":"application/json"}, o.headers || {})
    })).then(function(r) {
      if (!r.ok) return r.text().then(function(t) { throw new Error(r.status + ": " + t); });
      var ct = r.headers.get("content-type") || "";
      return ct.indexOf("json") !== -1 ? r.json() : r.text();
    });
  }
  ping() { return this._fetch("/_ping"); }
  version() { return this._fetch("/version"); }
  info() { return this._fetch("/info"); }
  containers(all) { return this._fetch("/containers/json?all=" + (all ? "1" : "0") + "&size=true"); }
  containerInspect(id) { return this._fetch("/containers/" + id + "/json"); }
  containerLogs(id, tail) { return this._fetch("/containers/" + id + "/logs?stdout=1&stderr=1&tail=" + (tail||300) + "&timestamps=1"); }
  containerStats(id) { return this._fetch("/containers/" + id + "/stats?stream=false"); }
  containerStart(id) { return this._fetch("/containers/" + id + "/start", {method:"POST"}); }
  containerStop(id) { return this._fetch("/containers/" + id + "/stop", {method:"POST"}); }
  containerRestart(id) { return this._fetch("/containers/" + id + "/restart", {method:"POST"}); }
  containerPause(id) { return this._fetch("/containers/" + id + "/pause", {method:"POST"}); }
  containerUnpause(id) { return this._fetch("/containers/" + id + "/unpause", {method:"POST"}); }
  containerRemove(id, f) { return this._fetch("/containers/" + id + "?force=" + (f?"1":"0"), {method:"DELETE"}); }
  containerExec(id, cmd) {
    var self = this;
    return this._fetch("/containers/" + id + "/exec", {
      method:"POST", body:JSON.stringify({AttachStdout:true,AttachStderr:true,Cmd:["sh","-c",cmd]})
    }).then(function(ex) {
      return self._fetch("/exec/" + ex.Id + "/start", {method:"POST",body:JSON.stringify({Detach:false})});
    });
  }
  containerCreate(name, config) {
    var qs = name ? "?name=" + encodeURIComponent(name) : "";
    return this._fetch("/containers/create" + qs, {method:"POST",body:JSON.stringify(config)});
  }
  images() { return this._fetch("/images/json"); }
  imageRemove(id, f) { return this._fetch("/images/" + id + "?force=" + (f?"1":"0"), {method:"DELETE"}); }
  imagePull(name) { return this._fetch("/images/create?fromImage=" + encodeURIComponent(name), {method:"POST"}); }
  volumes() { return this._fetch("/volumes"); }
  volumeRemove(n, f) { return this._fetch("/volumes/" + n + "?force=" + (f?"1":"0"), {method:"DELETE"}); }
  volumePrune() { return this._fetch("/volumes/prune", {method:"POST"}); }
  networks() { return this._fetch("/networks"); }
  networkRemove(id) { return this._fetch("/networks/" + id, {method:"DELETE"}); }
  // Hub search via proxy (does NOT touch Docker daemon)
  hubSearch(term) { return this._fetch("/docker-genius/hub/search?term=" + encodeURIComponent(term) + "&limit=20"); }
  composeUp(yaml, project) { return this._fetch("/docker-genius/compose/up", {method:"POST",body:JSON.stringify({yaml:yaml,project:project})}); }
  composeDown(yaml, project) { return this._fetch("/docker-genius/compose/down", {method:"POST",body:JSON.stringify({yaml:yaml,project:project})}); }
}

// -- Storage --
var LS = {
  get: function(k, d) { try { var v = JSON.parse(localStorage.getItem("dg_" + k)); return v != null ? v : (d != null ? d : null); } catch(e) { return d != null ? d : null; } },
  set: function(k, v) { localStorage.setItem("dg_" + k, JSON.stringify(v)); }
};

// -- Helpers --
function fmtBytes(b, d) { if (!b) return "0 B"; var dec=d||1,k=1024,s=["B","KB","MB","GB","TB"],i=Math.floor(Math.log(b)/Math.log(k)); return parseFloat((b/Math.pow(k,i)).toFixed(dec))+" "+s[i]; }
function timeAgo(ts) { if(!ts)return "-"; var s=Math.floor(Date.now()/1000-ts); if(s<60)return s+"s ago"; if(s<3600)return Math.floor(s/60)+"m ago"; if(s<86400)return Math.floor(s/3600)+"h ago"; return Math.floor(s/86400)+"d ago"; }
function shortId(id) { return (id||"").replace("sha256:","").substring(0,12); }
function cName(c) { return (c.Names&&c.Names[0]||"").replace(/^\//,"")||shortId(c.Id); }
function badgeCls(s) { return {running:"badge-running",exited:"badge-exited",dead:"badge-dead",paused:"badge-paused",created:"badge-created",restarting:"badge-restarting"}[(s||"").toLowerCase()]||""; }
function cleanLog(r) { if(!r) return ""; var s=typeof r==="string"?r:String(r); return s.replace(/[\x00-\x08]/g,"").replace(/[^\x20-\x7E\n\r\t]/g,""); }
function downloadJSON(data, filename) {
  var blob = new Blob([JSON.stringify(data, null, 2)], {type: "application/json"});
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

var Ctx = createContext(null);

// ===========================
// UI Components
// ===========================

function Toasts(p) {
  return (<div className="toast-wrap">{p.items.map(function(t) {
    var ic = t.type==="ok"?"check":t.type==="err"?"warn":"info";
    return <div key={t.id} className={"toast toast-"+t.type}><Icon name={ic}/> {t.msg}</div>;
  })}</div>);
}

function ConfirmDialog(p) {
  var d = p.data; if (!d) return null;
  function cancel() { if(d.onCancel) d.onCancel(); }
  function ok() { if(d.onConfirm) d.onConfirm(); }
  useEffect(function() {
    function kd(e) { if(e.key==="Escape") cancel(); if(e.key==="Enter") ok(); }
    document.addEventListener("keydown",kd);
    return function() { document.removeEventListener("keydown",kd); };
  },[d]);
  return (
    <div className="confirm-overlay" onClick={cancel}>
      <div className="confirm-box" onClick={function(e){e.stopPropagation();}}>
        <div className="confirm-body">
          <div className="confirm-icon confirm-icon-danger"><Icon name="trash"/></div>
          <div className="confirm-title">{d.title || "Confirm"}</div>
          <div className="confirm-msg" dangerouslySetInnerHTML={{__html:d.message||""}}/>
        </div>
        <div className="confirm-actions">
          <button className="confirm-btn-cancel" onClick={cancel}>Cancel</button>
          <button className="confirm-btn-ok" onClick={ok}>{d.confirmLabel||"Confirm"}</button>
        </div>
      </div>
    </div>
  );
}

// -- Connection Modal --
function ConnModal(p) {
  var _n=useState("");var name=_n[0],setName=_n[1];
  var _u=useState("");var url=_u[0],setUrl=_u[1];
  var _t=useState(false);var testing=_t[0],setTesting=_t[1];
  var _r=useState(null);var result=_r[0],setResult=_r[1];
  useEffect(function(){ if(p.editing){setName(p.editing.name);setUrl(p.editing.url)}else{setName("");setUrl("")} setResult(null); },[p.editing,p.show]);
  if(!p.show) return null;
  function test() {
    setTesting(true);setResult(null);
    var api=new DockerAPI(url);
    api.ping().then(function(){return api.version()}).then(function(v){ setResult({ok:true,msg:"Docker "+v.Version+" / API "+v.ApiVersion}); setTesting(false); })
    .catch(function(e){ setResult({ok:false,msg:e.message}); setTesting(false); });
  }
  return (
    <div className="overlay" onClick={p.onClose}><div className="modal" onClick={function(e){e.stopPropagation();}}>
      <div className="modal-hd"><h3><Icon name="connections"/> {p.editing?"Edit":"New"} Connection</h3><button className="ib" onClick={p.onClose}><Icon name="close"/></button></div>
      <div className="modal-bd">
        <div className="fg"><label>Name</label><input value={name} onChange={function(e){setName(e.target.value)}} placeholder="My Docker Host"/></div>
        <div className="fg fg-mono"><label>Endpoint URL</label><input value={url} onChange={function(e){setUrl(e.target.value)}} placeholder="http://192.168.1.100:9587"/>
          <div className="hint">Run <code style={{color:"var(--acl)",fontFamily:"JetBrains Mono",fontSize:11}}>python proxy.py</code> on your host. Default port: 9587</div></div>
        {result && <div className={"test-msg "+(result.ok?"test-ok":"test-fail")}>{result.ok?"[OK]":"[FAIL]"} {result.msg}</div>}
      </div>
      <div className="modal-ft">
        <button className="btn" onClick={test} disabled={!url||testing}>{testing?<span className="spinner"/>:<Icon name="search"/>} {testing?"Testing...":"Test"}</button>
        <button className="btn btn-ac" disabled={!name||!url} onClick={function(){p.onSave({name:name,url:url,id:p.editing?p.editing.id:null})}}><Icon name="check"/> {p.editing?"Update":"Save"}</button>
      </div>
    </div></div>
  );
}

// -- Container Detail Modal --
function DetailModal(p) {
  var ctx=useContext(Ctx);
  var _t=useState("logs");var tab=_t[0],setTab=_t[1];
  var _l=useState("");var logs=_l[0],setLogs=_l[1];
  var _i=useState(null);var inspect=_i[0],setInspect=_i[1];
  var _s=useState(null);var stats=_s[0],setStats=_s[1];
  var _ld=useState(true);var loading=_ld[0],setLoading=_ld[1];
  var endRef=useRef(null);
  useEffect(function(){ if(!p.cid||!ctx.docker) return; setLoading(true);
    Promise.allSettled([ctx.docker.containerLogs(p.cid,500),ctx.docker.containerInspect(p.cid),ctx.docker.containerStats(p.cid)])
    .then(function(r){ if(r[0].status==="fulfilled")setLogs(cleanLog(r[0].value)); if(r[1].status==="fulfilled")setInspect(r[1].value); if(r[2].status==="fulfilled")setStats(r[2].value); setLoading(false); });
  },[p.cid]);
  useEffect(function(){ if(endRef.current) endRef.current.scrollIntoView(); },[logs,tab]);
  if(!p.cid) return null;
  var nm=inspect?inspect.Name.replace(/^\//,""):shortId(p.cid);
  var cpuP=null;
  if(stats&&stats.cpu_stats&&stats.cpu_stats.cpu_usage&&stats.precpu_stats&&stats.precpu_stats.cpu_usage){
    var cd=stats.cpu_stats.cpu_usage.total_usage-stats.precpu_stats.cpu_usage.total_usage;
    var sd=stats.cpu_stats.system_cpu_usage-stats.precpu_stats.system_cpu_usage;
    if(sd>0) cpuP=(cd/sd*(stats.cpu_stats.online_cpus||1)*100).toFixed(1);
  }
  var memU=stats&&stats.memory_stats?stats.memory_stats.usage:null;
  var memL=stats&&stats.memory_stats?stats.memory_stats.limit:null;
  function renderTab() {
    if(tab==="logs") return <div className="logbox" style={{maxHeight:"50vh"}}>{logs||"No logs."}<div ref={endRef}/></div>;
    if(tab==="inspect"&&inspect) return <div className="logbox" style={{maxHeight:"50vh",fontSize:11}}>{JSON.stringify(inspect,null,2)}</div>;
    if(tab==="env"&&inspect) return (inspect.Config&&inspect.Config.Env||[]).map(function(e,i){ var pts=e.split("="); return <div key={i} style={{padding:"5px 0",borderBottom:"1px solid var(--brd)",display:"flex",gap:12,fontSize:12.5}}><span className="mono" style={{fontWeight:600,color:"var(--acl)",minWidth:170}}>{pts[0]}</span><span className="mono text-dim" style={{wordBreak:"break-all"}}>{pts.slice(1).join("=")}</span></div>; });
    if(tab==="ports"&&inspect){ var po=inspect.NetworkSettings&&inspect.NetworkSettings.Ports||{}; var ks=Object.keys(po); if(!ks.length) return <div className="text-dim" style={{padding:20,textAlign:"center"}}>No ports</div>; return ks.map(function(k){ var bn=po[k]; return <div key={k} style={{padding:"6px 0",borderBottom:"1px solid var(--brd)",display:"flex",gap:10,alignItems:"center",fontSize:13}}><span className="mono text-ac">{k}</span><span className="text-dim">&rarr;</span>{bn?bn.map(function(b,i){return <span key={i} className="mono">{(b.HostIp||"0.0.0.0")+":"+b.HostPort}</span>}):<span className="text-dim">not published</span>}</div>; }); }
    if(tab==="mounts"&&inspect){ var m=inspect.Mounts||[]; if(!m.length) return <div className="text-dim" style={{padding:20,textAlign:"center"}}>No mounts</div>; return m.map(function(mt,i){return <div key={i} style={{padding:"6px 0",borderBottom:"1px solid var(--brd)",fontSize:12.5}}><div className="mono text-ac text-xs">{mt.Type}</div><div className="mono">{mt.Source+" -> "+mt.Destination}</div><div className="text-dim text-xs">{mt.RW?"read-write":"read-only"}</div></div>;}); }
    return null;
  }
  return (
    <div className="overlay" onClick={p.onClose}><div className="modal" onClick={function(e){e.stopPropagation()}} style={{maxWidth:780}}>
      <div className="modal-hd"><h3><Icon name="containers"/> <span className="mono">{nm}</span></h3><button className="ib" onClick={p.onClose}><Icon name="close"/></button></div>
      {loading?<div style={{padding:40,textAlign:"center"}}><span className="spinner"/></div>:<div>
        {stats&&cpuP!==null&&<div style={{padding:"10px 22px",display:"flex",gap:20,borderBottom:"1px solid var(--brd)",fontSize:11.5,fontFamily:"JetBrains Mono,monospace",color:"var(--t3)"}}>
          <span>CPU <strong className="text-ac">{cpuP}%</strong></span><span>MEM <strong className="text-ac">{fmtBytes(memU)}</strong> / {fmtBytes(memL)}</span></div>}
        <div className="tab-row" style={{padding:"0 22px"}}>{["logs","inspect","env","ports","mounts"].map(function(t){ return <button key={t} className={"tab-btn"+(tab===t?" on":"")} onClick={function(){setTab(t)}}>{t.charAt(0).toUpperCase()+t.slice(1)}</button>; })}</div>
        <div style={{padding:"0 22px 22px",maxHeight:"55vh",overflowY:"auto"}}>{renderTab()}</div>
      </div>}
    </div></div>
  );
}

// ===========================
// PAGES
// ===========================

function WelcomePage() {
  var ctx=useContext(Ctx);
  return (<div className="empty" style={{paddingTop:60}}>
    <i className="ri-ship-2-line" style={{fontSize:64}}/>
    <h3 style={{fontSize:22,marginBottom:10,fontWeight:700}}>Docker<span style={{fontStyle:"italic",background:"linear-gradient(135deg,var(--acl),var(--ac2))",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Genius</span></h3>
    <p style={{lineHeight:1.7,marginBottom:20}}>Browser-based Docker management. No accounts, no servers. Connection data stays in your browser.</p>
    <div style={{background:"var(--card)",border:"1px solid var(--brd)",borderRadius:"var(--r3)",maxWidth:480,margin:"0 auto 20px",padding:20,textAlign:"left"}}>
      <div style={{fontWeight:600,marginBottom:10,color:"var(--acl)",fontFamily:"JetBrains Mono",fontSize:12,letterSpacing:".04em"}}>QUICK START</div>
      <ol style={{paddingLeft:20,display:"flex",flexDirection:"column",gap:10,color:"var(--t2)",fontSize:13}}>
        <li>Run on your Docker host: <code style={{display:"block",background:"var(--bg)",padding:"8px 10px",borderRadius:6,marginTop:6,fontFamily:"JetBrains Mono",fontSize:12,color:"var(--acl)"}}>python proxy.py</code></li>
        <li>Go to <strong style={{color:"var(--t1)"}}>Connections</strong> and add host IP + port 9587</li>
        <li>Manage your Docker stack</li>
      </ol>
    </div>
    <button className="btn btn-ac" onClick={function(){ctx.setPage("connections")}}><Icon name="plus"/> Add Connection</button>
  </div>);
}

// -- Dashboard --
function DashboardPage() {
  var ctx=useContext(Ctx); if(!ctx.docker) return <WelcomePage/>;
  var run=(ctx.containers||[]).filter(function(c){return c.State==="running"}).length;
  var stop=(ctx.containers||[]).filter(function(c){return c.State==="exited"}).length;
  var imgSz=(ctx.images||[]).reduce(function(a,i){return a+(i.Size||0)},0);
  var volC=ctx.volumes&&ctx.volumes.Volumes?ctx.volumes.Volumes.length:0;
  var sts=[{l:"Running",v:run,c:"c-green",s:"containers"},{l:"Stopped",v:stop,c:"c-red",s:"containers"},{l:"Images",v:(ctx.images||[]).length,c:"c-purple",s:fmtBytes(imgSz)},{l:"Volumes",v:volC,c:"",s:"total"},{l:"Networks",v:(ctx.networks||[]).length,c:"",s:"total"}];
  var running=(ctx.containers||[]).filter(function(c){return c.State==="running"});
  return (<div>
    <div className="stats">{sts.map(function(s,i){return <div className="stat" key={i}><div className="stat-label">{s.l}</div><div className={"stat-val "+s.c}>{s.v}</div><div className="stat-sub">{s.s}</div></div>})}</div>
    {ctx.sysInfo&&<div className="panel" style={{marginBottom:16}}><div className="ph"><Icon name="info"/> Host Information</div><div className="pb"><div className="info-grid">
      {[["Hostname",ctx.sysInfo.Name],["OS",ctx.sysInfo.OperatingSystem],["Kernel",ctx.sysInfo.KernelVersion],["Arch",ctx.sysInfo.Architecture],["CPUs",ctx.sysInfo.NCPU],["Memory",fmtBytes(ctx.sysInfo.MemTotal)],["Docker",ctx.sysInfo.ServerVersion],["Storage",ctx.sysInfo.Driver]].map(function(pr,i){return <div className="info-pair" key={i}><div className="info-k">{pr[0]}</div><div className="info-v">{pr[1]}</div></div>})}
    </div></div></div>}
    {running.length>0&&<div className="panel"><div className="ph"><Icon name="containers"/> Running Containers</div><div style={{overflowX:"auto"}}><table><thead><tr><th>Name</th><th>Image</th><th>Status</th><th>Created</th></tr></thead><tbody>
      {running.map(function(c){return <tr key={c.Id}><td className="mono" style={{fontWeight:600}}>{cName(c)}</td><td><span className="mono text-muted truncate">{c.Image}</span></td><td><span className={"badge-st "+badgeCls(c.State)}>{c.State}</span></td><td className="text-dim text-sm">{timeAgo(c.Created)}</td></tr>})}
    </tbody></table></div></div>}
  </div>);
}

// -- Containers --
function ContainersPage() {
  var ctx=useContext(Ctx);
  var _f=useState("");var filter=_f[0],setFilter=_f[1];
  var _a=useState(true);var showAll=_a[0],setShowAll=_a[1];
  var _d=useState(null);var detail=_d[0],setDetail=_d[1];
  var _ac=useState({});var acting=_ac[0],setActing=_ac[1];
  if(!ctx.docker) return <WelcomePage/>;
  function act(id,action,label){ setActing(function(p){var n=Object.assign({},p);n[id+action]=true;return n}); ctx.docker["container"+action](id,action==="Remove").then(function(){ctx.toast(label,"ok");setTimeout(ctx.refreshC,500)}).catch(function(e){ctx.toast(e.message,"err")}).finally(function(){setActing(function(p){var n=Object.assign({},p);n[id+action]=false;return n})}); }
  var list=(ctx.containers||[]).filter(function(c){ if(!showAll&&c.State!=="running")return false; if(!filter)return true; var q=filter.toLowerCase(); return cName(c).toLowerCase().indexOf(q)!==-1||c.Image.toLowerCase().indexOf(q)!==-1; });
  return (<div>
    <div className="toolbar"><div className="search-box"><Icon name="search"/><input placeholder="Filter..." value={filter} onChange={function(e){setFilter(e.target.value)}}/></div>
      <label className="chk-label"><input type="checkbox" checked={showAll} onChange={function(e){setShowAll(e.target.checked)}}/> Show stopped</label>
      <div className="spacer"/><button className="btn btn-sm" onClick={ctx.refreshC}><Icon name="refresh"/> Refresh</button></div>
    <div className="panel"><div style={{overflowX:"auto"}}><table><thead><tr><th>Name</th><th>Image</th><th>State</th><th>Status</th><th>Ports</th><th style={{textAlign:"right"}}>Actions</th></tr></thead><tbody>
      {list.length===0&&<tr><td colSpan={6} style={{textAlign:"center",padding:30,color:"var(--t3)"}}>{ctx.containers===null?<span className="spinner"/>:"No containers"}</td></tr>}
      {list.map(function(c){ var nm=cName(c); var ports=(c.Ports||[]).filter(function(p){return p.PublicPort}).map(function(p){return p.PublicPort+"->"+p.PrivatePort}).join(", ");
        var isR=c.State==="running",isP=c.State==="paused";
        return (<tr key={c.Id}>
          <td><span className="mono" style={{fontWeight:600,cursor:"pointer"}} onClick={function(){setDetail(c.Id)}}>{nm}</span><div className="mono text-xs text-dim">{shortId(c.Id)}</div></td>
          <td><span className="mono text-muted truncate" title={c.Image}>{c.Image}</span></td>
          <td><span className={"badge-st "+badgeCls(c.State)}>{c.State}</span></td>
          <td className="text-dim text-sm">{c.Status}</td>
          <td className="mono text-sm">{ports||<span className="text-dim">-</span>}</td>
          <td style={{textAlign:"right",whiteSpace:"nowrap"}}><div className="row" style={{justifyContent:"flex-end"}}>
            {!isR&&!isP&&<button className="ib ib-g" title="Start" onClick={function(){act(c.Id,"Start","Started")}}>{acting[c.Id+"Start"]?<span className="spinner"/>:<Icon name="play"/>}</button>}
            {isR&&<button className="ib ib-r" title="Stop" onClick={function(){act(c.Id,"Stop","Stopped")}}>{acting[c.Id+"Stop"]?<span className="spinner"/>:<Icon name="stop"/>}</button>}
            {isR&&<button className="ib ib-y" title="Pause" onClick={function(){act(c.Id,"Pause","Paused")}}><Icon name="pause"/></button>}
            {isP&&<button className="ib ib-g" title="Unpause" onClick={function(){act(c.Id,"Unpause","Unpaused")}}><Icon name="unpause"/></button>}
            <button className="ib" title="Restart" onClick={function(){act(c.Id,"Restart","Restarted")}}>{acting[c.Id+"Restart"]?<span className="spinner"/>:<Icon name="restart"/>}</button>
            <button className="ib" title="Details" onClick={function(){setDetail(c.Id)}}><Icon name="eye"/></button>
            <button className="ib ib-r" title="Remove" onClick={function(){ctx.askConfirm({title:"Remove Container",message:"Remove container <code>"+nm+"</code> ?",confirmLabel:"Remove"},function(){act(c.Id,"Remove","Removed")})}}><Icon name="trash"/></button>
          </div></td></tr>); })}
    </tbody></table></div></div>
    <DetailModal cid={detail} onClose={function(){setDetail(null)}}/>
  </div>);
}

// -- Images --
function ImagesPage() {
  var ctx=useContext(Ctx);
  var _f=useState("");var filter=_f[0],setFilter=_f[1];
  var _pn=useState("");var pullName=_pn[0],setPullName=_pn[1];
  var _pl=useState(false);var pulling=_pl[0],setPulling=_pl[1];
  if(!ctx.docker) return <WelcomePage/>;
  function doPull(){ if(!pullName)return; setPulling(true); ctx.docker.imagePull(pullName).then(function(){ctx.toast("Pull started: "+pullName,"ok");setTimeout(ctx.refreshI,2000)}).catch(function(e){ctx.toast(e.message,"err")}).finally(function(){setPulling(false);setPullName("")}); }
  function doRm(id,tag){ ctx.askConfirm({title:"Remove Image",message:"Remove <code>"+tag+"</code> ?",confirmLabel:"Remove"},function(){ ctx.docker.imageRemove(id,false).then(function(){ctx.toast("Removed","ok");ctx.refreshI()}).catch(function(e){ctx.toast(e.message,"err")}); }); }
  var list=(ctx.images||[]).filter(function(img){ if(!filter)return true; return (img.RepoTags||[]).join(" ").toLowerCase().indexOf(filter.toLowerCase())!==-1; });
  return (<div>
    <div className="toolbar"><div className="search-box"><Icon name="search"/><input placeholder="Filter..." value={filter} onChange={function(e){setFilter(e.target.value)}}/></div><div className="spacer"/>
      <input className="mono" style={{padding:"6px 10px",background:"var(--inp)",border:"1px solid var(--brd)",borderRadius:"var(--r1)",color:"var(--t1)",fontSize:12,width:200,fontFamily:"JetBrains Mono,monospace"}} placeholder="nginx:latest" value={pullName} onChange={function(e){setPullName(e.target.value)}} onKeyDown={function(e){if(e.key==="Enter")doPull()}}/>
      <button className="btn btn-sm btn-ac" onClick={doPull} disabled={pulling||!pullName}>{pulling?<span className="spinner"/>:<Icon name="download"/>} Pull</button>
      <button className="btn btn-sm" onClick={ctx.refreshI}><Icon name="refresh"/></button></div>
    <div className="panel"><div style={{overflowX:"auto"}}><table><thead><tr><th>Repository:Tag</th><th>ID</th><th>Size</th><th>Created</th><th style={{textAlign:"right"}}></th></tr></thead><tbody>
      {list.length===0&&<tr><td colSpan={5} style={{textAlign:"center",padding:30,color:"var(--t3)"}}>{ctx.images===null?<span className="spinner"/>:"No images"}</td></tr>}
      {list.map(function(img){ return (img.RepoTags||["<none>:<none>"]).map(function(tag,ti){ return <tr key={img.Id+ti}><td className="mono" style={{fontWeight:600}}>{tag}</td><td className="mono text-dim text-sm">{shortId(img.Id)}</td><td className="mono text-sm">{fmtBytes(img.Size)}</td><td className="text-dim text-sm">{timeAgo(img.Created)}</td><td style={{textAlign:"right"}}><button className="ib ib-r" onClick={function(){doRm(img.Id,tag)}}><Icon name="trash"/></button></td></tr>; }); })}
    </tbody></table></div></div>
  </div>);
}

// -- Volumes --
function VolumesPage() {
  var ctx=useContext(Ctx); var _f=useState("");var filter=_f[0],setFilter=_f[1]; if(!ctx.docker) return <WelcomePage/>;
  function doRm(n){ ctx.askConfirm({title:"Remove Volume",message:"Remove <code>"+n+"</code> ?",confirmLabel:"Remove"},function(){ ctx.docker.volumeRemove(n,false).then(function(){ctx.toast("Removed","ok");ctx.refreshV()}).catch(function(e){ctx.toast(e.message,"err")}); }); }
  function doPrune(){ ctx.askConfirm({title:"Prune Volumes",message:"Remove all unused volumes? This cannot be undone.",confirmLabel:"Prune All"},function(){ ctx.docker.volumePrune().then(function(r){ctx.toast("Pruned - "+fmtBytes(r.SpaceReclaimed||0)+" reclaimed","ok");ctx.refreshV()}).catch(function(e){ctx.toast(e.message,"err")}); }); }
  var vols=ctx.volumes&&ctx.volumes.Volumes?ctx.volumes.Volumes:[];
  var list=vols.filter(function(v){return !filter||v.Name.toLowerCase().indexOf(filter.toLowerCase())!==-1});
  return (<div>
    <div className="toolbar"><div className="search-box"><Icon name="search"/><input placeholder="Filter..." value={filter} onChange={function(e){setFilter(e.target.value)}}/></div><div className="spacer"/>
      <button className="btn btn-sm btn-danger" onClick={doPrune}><Icon name="prune"/> Prune</button><button className="btn btn-sm" onClick={ctx.refreshV}><Icon name="refresh"/></button></div>
    <div className="panel"><div style={{overflowX:"auto"}}><table><thead><tr><th>Name</th><th>Driver</th><th>Mountpoint</th><th style={{textAlign:"right"}}></th></tr></thead><tbody>
      {list.length===0&&<tr><td colSpan={4} style={{textAlign:"center",padding:30,color:"var(--t3)"}}>No volumes</td></tr>}
      {list.map(function(v){return <tr key={v.Name}><td className="mono" style={{fontWeight:600,maxWidth:280,overflow:"hidden",textOverflow:"ellipsis"}} title={v.Name}>{v.Name}</td><td><span className="tag">{v.Driver}</span></td><td className="mono text-dim text-sm truncate" title={v.Mountpoint}>{v.Mountpoint}</td><td style={{textAlign:"right"}}><button className="ib ib-r" onClick={function(){doRm(v.Name)}}><Icon name="trash"/></button></td></tr>})}
    </tbody></table></div></div>
  </div>);
}

// -- Networks --
function NetworksPage() {
  var ctx=useContext(Ctx); var _f=useState("");var filter=_f[0],setFilter=_f[1]; if(!ctx.docker) return <WelcomePage/>;
  function doRm(id,n){ ctx.askConfirm({title:"Remove Network",message:"Remove <code>"+n+"</code> ?",confirmLabel:"Remove"},function(){ ctx.docker.networkRemove(id).then(function(){ctx.toast("Removed","ok");ctx.refreshN()}).catch(function(e){ctx.toast(e.message,"err")}); }); }
  var list=(ctx.networks||[]).filter(function(n){return !filter||n.Name.toLowerCase().indexOf(filter.toLowerCase())!==-1});
  return (<div>
    <div className="toolbar"><div className="search-box"><Icon name="search"/><input placeholder="Filter..." value={filter} onChange={function(e){setFilter(e.target.value)}}/></div><div className="spacer"/><button className="btn btn-sm" onClick={ctx.refreshN}><Icon name="refresh"/></button></div>
    <div className="panel"><div style={{overflowX:"auto"}}><table><thead><tr><th>Name</th><th>ID</th><th>Driver</th><th>Scope</th><th>Subnet</th><th style={{textAlign:"right"}}></th></tr></thead><tbody>
      {list.length===0&&<tr><td colSpan={6} style={{textAlign:"center",padding:30,color:"var(--t3)"}}>No networks</td></tr>}
      {list.map(function(n){ var sub=n.IPAM&&n.IPAM.Config&&n.IPAM.Config[0]?n.IPAM.Config[0].Subnet:"-"; var bi=["bridge","host","none"].indexOf(n.Name)!==-1;
        return <tr key={n.Id}><td className="mono" style={{fontWeight:600}}>{n.Name}</td><td className="mono text-dim text-sm">{shortId(n.Id)}</td><td><span className="tag">{n.Driver}</span></td><td className="text-sm">{n.Scope}</td><td className="mono text-sm">{sub}</td><td style={{textAlign:"right"}}>{!bi&&<button className="ib ib-r" onClick={function(){doRm(n.Id,n.Name)}}><Icon name="trash"/></button>}</td></tr>; })}
    </tbody></table></div></div>
  </div>);
}

// -- Deploy --
function DeployPage() {
  var ctx=useContext(Ctx); var _t=useState("create");var tab=_t[0],setTab=_t[1]; if(!ctx.docker) return <WelcomePage/>;
  return (<div>
    <div className="deploy-tabs">
      <button className={"deploy-tab"+(tab==="create"?" on":"")} onClick={function(){setTab("create")}}><Icon name="plus"/> Create Container</button>
      <button className={"deploy-tab"+(tab==="compose"?" on":"")} onClick={function(){setTab("compose")}}><Icon name="compose"/> Compose Deploy</button>
    </div>
    {tab==="create"&&<CreateContainerTab/>}{tab==="compose"&&<ComposeTab/>}
  </div>);
}

function CreateContainerTab() {
  var ctx=useContext(Ctx);
  var _st=useState("");var searchTerm=_st[0],setSearchTerm=_st[1];
  var _res=useState(null);var results=_res[0],setResults=_res[1];
  var _srch=useState(false);var searching=_srch[0],setSearching=_srch[1];
  var _img=useState("");var imageName=_img[0],setImageName=_img[1];
  var _cn=useState("");var contName=_cn[0],setContName=_cn[1];
  var _po=useState([{host:"",container:""}]);var ports=_po[0],setPorts=_po[1];
  var _vo=useState([{host:"",container:""}]);var vols=_vo[0],setVols=_vo[1];
  var _env=useState([{key:"",val:""}]);var envs=_env[0],setEnvs=_env[1];
  var _rs=useState("unless-stopped");var restart=_rs[0],setRestart=_rs[1];
  var _cmd=useState("");var cmd=_cmd[0],setCmd=_cmd[1];
  var _dep=useState(false);var deploying=_dep[0],setDeploying=_dep[1];

  function doSearch() {
    if(!searchTerm.trim()) return; setSearching(true);
    // Uses proxy hub search endpoint -- does NOT touch Docker daemon
    ctx.docker.hubSearch(searchTerm.trim()).then(function(r){setResults(r||[]);setSearching(false)}).catch(function(e){ctx.toast(e.message,"err");setSearching(false)});
  }
  function updArr(setter,idx,field,val){ setter(function(p){return p.map(function(x,i){if(i!==idx)return x;var n=Object.assign({},x);n[field]=val;return n})}); }
  function addArr(setter,tmpl){ setter(function(p){return p.concat([tmpl])}); }
  function rmArr(setter,idx){ setter(function(p){return p.filter(function(_,i){return i!==idx})}); }

  function doDeploy() {
    if(!imageName){ctx.toast("Enter an image name","err");return;} setDeploying(true);
    var ep={},pb={};
    ports.forEach(function(p){if(p.host&&p.container){var k=p.container+"/tcp";ep[k]={};pb[k]=[{HostPort:String(p.host)}]}});
    var binds=[]; vols.forEach(function(v){if(v.host&&v.container) binds.push(v.host+":"+v.container)});
    var env=[]; envs.forEach(function(e){if(e.key) env.push(e.key+"="+e.val)});
    var rp={Name:restart}; if(restart==="on-failure") rp.MaximumRetryCount=5;
    var config={Image:imageName,ExposedPorts:ep,Env:env.length?env:undefined,Cmd:cmd.trim()?cmd.trim().split(/\s+/):undefined,HostConfig:{PortBindings:pb,Binds:binds.length?binds:undefined,RestartPolicy:rp}};
    ctx.toast("Pulling image...","info");
    ctx.docker.imagePull(imageName).then(function(){return ctx.docker.containerCreate(contName||null,config)}).then(function(cr){ctx.toast("Starting...","info");return ctx.docker.containerStart(cr.Id)}).then(function(){ctx.toast("Container deployed","ok");setDeploying(false);ctx.refreshC();ctx.refreshI()}).catch(function(e){ctx.toast(e.message,"err");setDeploying(false)});
  }

  return (<div className="two-col">
    <div><div className="panel"><div className="ph"><Icon name="hub"/> Docker Hub Search</div><div className="pb">
      <div className="row" style={{marginBottom:0}}>
        <div className="search-box" style={{flex:1}}><Icon name="search"/><input style={{width:"100%"}} placeholder="Search Docker Hub..." value={searchTerm} onChange={function(e){setSearchTerm(e.target.value)}} onKeyDown={function(e){if(e.key==="Enter")doSearch()}}/></div>
        <button className="btn btn-sm btn-ac" onClick={doSearch} disabled={searching}>{searching?<span className="spinner"/>:<Icon name="search"/>} Search</button>
      </div>
      {results&&results.length>0&&<div className="hub-grid">{results.map(function(r){ var sel=imageName===r.name; return <div key={r.name} className={"hub-card"+(sel?" selected":"")} onClick={function(){setImageName(r.name)}}>
        <div className="hub-card-info"><div className="hub-card-name">{r.name}</div><div className="hub-card-desc">{r.description||"No description"}</div>
          <div className="hub-card-meta"><span><Icon name="star"/> {r.star_count||0}</span>{r.is_official&&<span className="hub-official">OFFICIAL</span>}{r.pull_count!=null&&<span>{r.pull_count.toLocaleString()} pulls</span>}</div>
        </div></div>; })}</div>}
      {results&&results.length===0&&<div className="text-dim" style={{padding:"20px 0",textAlign:"center",fontSize:13}}>No results</div>}
    </div></div></div>
    <div><div className="panel"><div className="ph"><Icon name="settings"/> Container Configuration</div><div className="pb">
      <div className="fg fg-mono"><label>Image</label><input value={imageName} onChange={function(e){setImageName(e.target.value)}} placeholder="nginx:latest"/><div className="hint">Select from search or type manually</div></div>
      <div className="fg fg-mono"><label>Container Name <span style={{color:"var(--t3)",fontWeight:400}}>(optional)</span></label><input value={contName} onChange={function(e){setContName(e.target.value)}} placeholder="my-app"/></div>
      <div className="fg"><label>Port Mappings</label><div className="dyn-rows">{ports.map(function(p,i){return <div className="dyn-row" key={i}><input placeholder="Host" value={p.host} onChange={function(e){updArr(setPorts,i,"host",e.target.value)}}/><span className="sep">:</span><input placeholder="Container" value={p.container} onChange={function(e){updArr(setPorts,i,"container",e.target.value)}}/><button className="ib ib-r" onClick={function(){rmArr(setPorts,i)}} style={{flexShrink:0}}><Icon name="close"/></button></div>})}</div><button className="btn btn-sm" style={{marginTop:6}} onClick={function(){addArr(setPorts,{host:"",container:""})}}><Icon name="plus"/> Add Port</button></div>
      <div className="fg"><label>Volume Mounts</label><div className="dyn-rows">{vols.map(function(v,i){return <div className="dyn-row" key={i}><input placeholder="Host path" value={v.host} onChange={function(e){updArr(setVols,i,"host",e.target.value)}}/><span className="sep">:</span><input placeholder="Container path" value={v.container} onChange={function(e){updArr(setVols,i,"container",e.target.value)}}/><button className="ib ib-r" onClick={function(){rmArr(setVols,i)}} style={{flexShrink:0}}><Icon name="close"/></button></div>})}</div><button className="btn btn-sm" style={{marginTop:6}} onClick={function(){addArr(setVols,{host:"",container:""})}}><Icon name="plus"/> Add Volume</button></div>
      <div className="fg"><label>Environment Variables</label><div className="dyn-rows">{envs.map(function(e,i){return <div className="dyn-row" key={i}><input placeholder="KEY" value={e.key} onChange={function(ev){updArr(setEnvs,i,"key",ev.target.value)}}/><span className="sep">=</span><input placeholder="value" value={e.val} onChange={function(ev){updArr(setEnvs,i,"val",ev.target.value)}}/><button className="ib ib-r" onClick={function(){rmArr(setEnvs,i)}} style={{flexShrink:0}}><Icon name="close"/></button></div>})}</div><button className="btn btn-sm" style={{marginTop:6}} onClick={function(){addArr(setEnvs,{key:"",val:""})}}><Icon name="plus"/> Add Variable</button></div>
      <div className="fg"><label>Restart Policy</label><select value={restart} onChange={function(e){setRestart(e.target.value)}} style={{width:"100%",padding:"10px 14px",background:"var(--inp)",border:"1px solid var(--brd)",borderRadius:"var(--r1)",color:"var(--t1)",fontFamily:"inherit",fontSize:13.5,outline:"none",cursor:"pointer",appearance:"none"}}><option value="no">No</option><option value="always">Always</option><option value="unless-stopped">Unless Stopped</option><option value="on-failure">On Failure</option></select></div>
      <div className="fg fg-mono"><label>Command Override <span style={{color:"var(--t3)",fontWeight:400}}>(optional)</span></label><input value={cmd} onChange={function(e){setCmd(e.target.value)}} placeholder="e.g. nginx -g 'daemon off;'"/></div>
      <button className="btn btn-ac" style={{width:"100%",justifyContent:"center",marginTop:8,padding:"11px 20px"}} onClick={doDeploy} disabled={deploying||!imageName}>{deploying?<span className="spinner"/>:<Icon name="deploy"/>} {deploying?"Deploying...":"Pull + Create + Start"}</button>
    </div></div></div>
  </div>);
}

// -- Compose with log toggle --
function ComposeTab() {
  var ctx=useContext(Ctx);
  var _y=useState("");var yaml=_y[0],setYaml=_y[1];
  var _p=useState("my-stack");var project=_p[0],setProject=_p[1];
  var _d=useState(false);var deploying=_d[0],setDeploying=_d[1];
  var _o=useState(null);var output=_o[0],setOutput=_o[1];
  var _dn=useState(false);var downing=_dn[0],setDowning=_dn[1];
  var _err=useState(false);var errOnly=_err[0],setErrOnly=_err[1];

  var placeholder="version: '3.8'\nservices:\n  web:\n    image: nginx:alpine\n    ports:\n      - '8080:80'\n    restart: unless-stopped";

  function doUp(){ if(!yaml.trim()){ctx.toast("Paste a docker-compose.yml","err");return} setDeploying(true);setOutput(null);
    ctx.docker.composeUp(yaml,project).then(function(r){setOutput(r);ctx.toast(r.ok?"Stack deployed":"Deploy had errors",r.ok?"ok":"err");setDeploying(false);if(r.ok){ctx.refreshC();ctx.refreshI()}}).catch(function(e){setOutput({ok:false,error:e.message,stdout:"",stderr:""});ctx.toast(e.message,"err");setDeploying(false)}); }
  function doDown(){ if(!project.trim()){ctx.toast("Enter project name","err");return} setDowning(true);setOutput(null);
    ctx.docker.composeDown(yaml,project).then(function(r){setOutput(r);ctx.toast(r.ok?"Stack torn down":"Errors during teardown",r.ok?"ok":"err");setDowning(false);if(r.ok)ctx.refreshC()}).catch(function(e){setOutput({ok:false,error:e.message,stdout:"",stderr:""});ctx.toast(e.message,"err");setDowning(false)}); }

  var outputText="";
  if(output){
    if(output.error) outputText+="[ERROR] "+output.error+"\n";
    if(errOnly){
      if(output.stderr) outputText+=output.stderr;
    } else {
      if(output.stdout) outputText+=output.stdout;
      if(output.stderr) outputText+=output.stderr;
    }
  }

  return (<div>
    <div className="panel"><div className="ph"><Icon name="compose"/> Docker Compose</div><div className="pb">
      <div className="fg fg-mono"><label>Project Name</label><input value={project} onChange={function(e){setProject(e.target.value)}} placeholder="my-stack"/><div className="hint">Used as --project-name</div></div>
      <div className="fg"><label>docker-compose.yml</label><textarea className="compose-area" value={yaml} onChange={function(e){setYaml(e.target.value)}} placeholder={placeholder} spellCheck={false}/><div className="hint">Paste full docker-compose.yml content. The proxy writes it to a temp file and runs docker compose up.</div></div>
      <div className="row" style={{gap:10,marginBottom:12}}>
        <button className="btn btn-ac" style={{flex:1,justifyContent:"center",padding:"11px 20px"}} onClick={doUp} disabled={deploying||!yaml.trim()}>{deploying?<span className="spinner"/>:<Icon name="deploy"/>} {deploying?"Deploying...":"Deploy Stack (up -d)"}</button>
        <button className="btn btn-danger" style={{justifyContent:"center",padding:"11px 20px"}} onClick={doDown} disabled={downing||!project.trim()}>{downing?<span className="spinner"/>:<Icon name="stop"/>} {downing?"Stopping...":"Tear Down"}</button>
      </div>
      <div className="toggle-row">
        <button className={"toggle"+(errOnly?" on":"")} onClick={function(){setErrOnly(!errOnly)}}/>
        <span>Errors only</span>
      </div>
      {output&&<div className="deploy-output" style={{color:output.ok?"var(--ok)":"var(--err)"}}>{outputText||(output.ok?"Success":"Failed - no output")}</div>}
    </div></div>
  </div>);
}

// -- Console --
function ConsolePage() {
  var ctx=useContext(Ctx);
  var _c=useState("");var cid=_c[0],setCid=_c[1];
  var _l=useState([{text:"Select a running container, then type commands below.",cls:"sys"}]);var lines=_l[0],setLines=_l[1];
  var _cm=useState("");var cmd=_cm[0],setCmd=_cm[1];
  var _b=useState(false);var busy=_b[0],setBusy=_b[1];
  var endRef=useRef(null); var inputRef=useRef(null);
  useEffect(function(){if(endRef.current) endRef.current.scrollIntoView({behavior:"smooth"})},[lines]);
  if(!ctx.docker) return <WelcomePage/>;
  var running=(ctx.containers||[]).filter(function(c){return c.State==="running"});
  function exec(){ if(!cmd.trim()||!cid)return; var command=cmd.trim();setCmd(""); setLines(function(p){return p.concat([{text:"$ "+command,cls:"cmd"}])}); setBusy(true);
    ctx.docker.containerExec(cid,command).then(function(out){var c=cleanLog(typeof out==="string"?out:JSON.stringify(out));setLines(function(p){return p.concat([{text:c.trim()||(("no output")),cls:c.trim()?"":"sys"}])})}).catch(function(e){setLines(function(p){return p.concat([{text:"Error: "+e.message,cls:"err"}])})}).finally(function(){setBusy(false);if(inputRef.current) inputRef.current.focus()});
  }
  return (<div>
    <div className="toolbar" style={{marginBottom:16}}>
      <select style={{width:220,padding:"7px 12px",background:"var(--inp)",border:"1px solid var(--brd)",borderRadius:"var(--r1)",color:"var(--t1)",fontFamily:"JetBrains Mono,monospace",fontSize:12.5}} value={cid} onChange={function(e){var v=e.target.value;setCid(v);if(v){var c=running.find(function(r){return r.Id===v});setLines([{text:"Attached to "+(c?cName(c):"container"),cls:"sys"}])}}}>
        <option value="">Select container...</option>{running.map(function(c){return <option key={c.Id} value={c.Id}>{cName(c)}</option>})}
      </select><div className="spacer"/><button className="btn btn-sm" onClick={function(){setLines([{text:"Cleared.",cls:"sys"}])}}><Icon name="trash"/> Clear</button></div>
    <div className="term">
      <div className="term-top"><div className="term-dots"><span/><span/><span/></div><span style={{flex:1}}>Docker Genius Console</span>{busy&&<span className="spinner"/>}</div>
      <div className="term-output">{lines.map(function(l,i){var cls=l.cls==="cmd"?"term-line-cmd":l.cls==="err"?"term-line-err":l.cls==="sys"?"term-line-sys":"";return <div key={i} className={cls}>{l.text}</div>})}<div ref={endRef}/></div>
      <div className="term-input"><span className="prompt">{cid?"$":"#"}</span><input ref={inputRef} value={cmd} onChange={function(e){setCmd(e.target.value)}} onKeyDown={function(e){if(e.key==="Enter")exec()}} placeholder={cid?"Type command...":"Select a container first"} disabled={!cid||busy}/></div>
    </div>
  </div>);
}

// -- Connections with Backup/Restore --
function ConnectionsPage() {
  var ctx=useContext(Ctx);
  var _m=useState(false);var modal=_m[0],setModal=_m[1];
  var _e=useState(null);var editing=_e[0],setEditing=_e[1];
  var fileRef=useRef(null);

  function save(d){ var up; if(d.id){up=ctx.connections.map(function(c){return c.id===d.id?{id:c.id,name:d.name,url:d.url}:c})}else{up=ctx.connections.concat([{id:Date.now().toString(36),name:d.name,url:d.url}])} ctx.setConnections(up);LS.set("conns",up);ctx.toast(d.id?"Updated":"Saved","ok");setModal(false);setEditing(null); }
  function del(id){ var conn=ctx.connections.find(function(c){return c.id===id}); ctx.askConfirm({title:"Delete Connection",message:"Delete <code>"+(conn?conn.name:id)+"</code> ?",confirmLabel:"Delete"},function(){ var up=ctx.connections.filter(function(c){return c.id!==id});ctx.setConnections(up);LS.set("conns",up);if(ctx.activeConn===id)ctx.setActiveConn(null);ctx.toast("Deleted","info"); }); }
  function connect(id){ ctx.setActiveConn(id);LS.set("active",id);ctx.toast("Connecting...","info"); }

  function doBackup() {
    var data = { version: 1, exported: new Date().toISOString(), connections: ctx.connections, active: ctx.activeConn };
    downloadJSON(data, "docker-genius-backup.json");
    ctx.toast("Backup downloaded", "ok");
  }

  function doRestore(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      try {
        var data = JSON.parse(ev.target.result);
        if (!data.connections || !Array.isArray(data.connections)) throw new Error("Invalid backup file");
        // Merge: keep existing, add new by URL
        var existing = ctx.connections;
        var existingUrls = existing.map(function(c) { return c.url; });
        var added = 0;
        data.connections.forEach(function(c) {
          if (existingUrls.indexOf(c.url) === -1) {
            existing = existing.concat([{ id: c.id || Date.now().toString(36) + (added++), name: c.name, url: c.url }]);
          }
        });
        ctx.setConnections(existing);
        LS.set("conns", existing);
        if (data.active && !ctx.activeConn) {
          ctx.setActiveConn(data.active);
          LS.set("active", data.active);
        }
        ctx.toast("Restored " + data.connections.length + " connections (" + added + " new)", "ok");
      } catch (err) {
        ctx.toast("Invalid backup: " + err.message, "err");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  return (<div>
    <div className="toolbar" style={{marginBottom:16}}>
      <button className="btn btn-sm" onClick={doBackup}><Icon name="backup"/> Backup</button>
      <button className="btn btn-sm" onClick={function(){fileRef.current&&fileRef.current.click()}}><Icon name="restore"/> Restore</button>
      <input ref={fileRef} type="file" accept=".json" className="file-input-hidden" onChange={doRestore}/>
      <div className="spacer"/>
      <button className="btn btn-ac" onClick={function(){setEditing(null);setModal(true)}}><Icon name="plus"/> New Connection</button>
    </div>
    {ctx.connections.length===0?<div className="empty"><i className="ri-plug-line"/><h3>No connections</h3><p>Add a Docker host to get started.</p></div>:
      ctx.connections.map(function(c){ var isA=c.id===ctx.activeConn; return <div key={c.id} className={"conn-card"+(isA?" active":"")}>
        <div className={"dot dot-lg"+(isA?" dot-ok":" dot-off")}/>
        <div style={{flex:1}}><div style={{fontWeight:600,fontSize:14}}>{c.name}</div><div className="mono text-dim text-sm">{c.url}</div></div>
        <div className="row">{!isA&&<button className="btn btn-sm btn-ac" onClick={function(){connect(c.id)}}>Connect</button>}{isA&&<span className="badge-st badge-running">Active</span>}
          <button className="ib" onClick={function(){setEditing(c);setModal(true)}}><Icon name="settings"/></button>
          <button className="ib ib-r" onClick={function(){del(c.id)}}><Icon name="trash"/></button></div>
      </div>; })}
    <ConnModal show={modal} onClose={function(){setModal(false);setEditing(null)}} onSave={save} editing={editing}/>
  </div>);
}

// ===========================
// APP SHELL
// ===========================
function App() {
  var _p=useState("dashboard");var page=_p[0],setPage=_p[1];
  var _c=useState(LS.get("conns",[]));var connections=_c[0],setConnections=_c[1];
  var _ac=useState(LS.get("active",null));var activeConn=_ac[0],setActiveConn=_ac[1];
  var _cs=useState("off");var connStatus=_cs[0],setConnStatus=_cs[1];
  var _d=useState(null);var docker=_d[0],setDocker=_d[1];
  var _si=useState(null);var sysInfo=_si[0],setSysInfo=_si[1];
  var _ct=useState(null);var containers=_ct[0],setContainers=_ct[1];
  var _im=useState(null);var images=_im[0],setImages=_im[1];
  var _vo=useState(null);var volumes=_vo[0],setVolumes=_vo[1];
  var _ne=useState(null);var networks=_ne[0],setNetworks=_ne[1];
  var _to=useState([]);var toasts=_to[0],setToasts=_to[1];
  var _cf=useState(null);var confirmData=_cf[0],setConfirmData=_cf[1];
  var pollRef=useRef(null);

  var toast=useCallback(function(msg,type){var id=Date.now();setToasts(function(t){return t.concat([{id:id,msg:msg,type:type||"info"}])});setTimeout(function(){setToasts(function(t){return t.filter(function(x){return x.id!==id})})},3500)},[]);
  var askConfirm=useCallback(function(opts,onYes){setConfirmData({title:opts.title,message:opts.message,confirmLabel:opts.confirmLabel||"Confirm",onConfirm:function(){setConfirmData(null);if(onYes)onYes()},onCancel:function(){setConfirmData(null)}})},[]);
  var conn=useMemo(function(){return connections.find(function(c){return c.id===activeConn})||null},[connections,activeConn]);

  useEffect(function(){
    if(pollRef.current) clearInterval(pollRef.current);
    if(!conn){setDocker(null);setConnStatus("off");setSysInfo(null);setContainers(null);setImages(null);setVolumes(null);setNetworks(null);return}
    var api=new DockerAPI(conn.url);setDocker(api);setConnStatus("loading");
    function load(){Promise.all([api.info(),api.containers(true),api.images(),api.volumes(),api.networks()]).then(function(r){setSysInfo(r[0]);setContainers(r[1]);setImages(r[2]);setVolumes(r[3]);setNetworks(r[4]);setConnStatus("ok")}).catch(function(){setConnStatus("err")})}
    load(); pollRef.current=setInterval(load,10000);
    return function(){clearInterval(pollRef.current)};
  },[conn?conn.id:null,conn?conn.url:null]);

  var refreshC=useCallback(function(){if(docker)docker.containers(true).then(setContainers).catch(function(){})},[docker]);
  var refreshI=useCallback(function(){if(docker)docker.images().then(setImages).catch(function(){})},[docker]);
  var refreshV=useCallback(function(){if(docker)docker.volumes().then(setVolumes).catch(function(){})},[docker]);
  var refreshN=useCallback(function(){if(docker)docker.networks().then(setNetworks).catch(function(){})},[docker]);

  var counts={containers:containers?containers.length:null,images:images?images.length:null,volumes:volumes&&volumes.Volumes?volumes.Volumes.length:null,networks:networks?networks.length:null};
  var navItems=[
    {id:"dashboard",icon:"dashboard",label:"Dashboard"},
    {id:"containers",icon:"containers",label:"Containers",count:counts.containers},
    {id:"images",icon:"images",label:"Images",count:counts.images},
    {id:"volumes",icon:"volumes",label:"Volumes",count:counts.volumes},
    {id:"networks",icon:"networks",label:"Networks",count:counts.networks},
    {id:"deploy",icon:"deploy",label:"Deploy"},
    {id:"console",icon:"console",label:"Console"},
    {id:"_sep"},
    {id:"connections",icon:"connections",label:"Connections"},
  ];
  var pageMap={dashboard:DashboardPage,containers:ContainersPage,images:ImagesPage,volumes:VolumesPage,networks:NetworksPage,deploy:DeployPage,console:ConsolePage,connections:ConnectionsPage};
  var PageComp=pageMap[page]||DashboardPage;
  var pillCls=connStatus==="ok"?"conn-ok":connStatus==="err"?"conn-err":"conn-off";
  var dotCls=connStatus==="ok"?"dot-ok":connStatus==="err"?"dot-err":"dot-off";
  var ctxVal={docker:docker,sysInfo:sysInfo,containers:containers,images:images,volumes:volumes,networks:networks,connections:connections,setConnections:setConnections,activeConn:activeConn,setActiveConn:setActiveConn,setPage:setPage,refreshC:refreshC,refreshI:refreshI,refreshV:refreshV,refreshN:refreshN,toast:toast,askConfirm:askConfirm};

  return (
    <Ctx.Provider value={ctxVal}>
      <div className="shell">
        <header>
          <div className="logo"><div className="logo-icon"><i className="ri-ship-2-line"/></div><div className="logo-text"><span className="p1">Docker</span><span className="p2">Genius</span></div></div>
          <div className="hdr-right">
            <div className={"conn-pill "+pillCls}><div className={"dot "+dotCls}/>{conn?conn.name:"Not connected"}</div>
            <a className="hlink" href="https://github.com/NUCL3ARN30N/docker-genius" target="_blank" rel="noopener"><i className="ri-github-fill"/> GitHub</a>
          </div>
        </header>
        <div className="body">
          <nav className="sidebar">
            {navItems.map(function(it){if(it.id==="_sep") return <div key="_sep" className="nav-sep"/>;
              return <button key={it.id} className={"nav-btn"+(page===it.id?" on":"")} onClick={function(){setPage(it.id)}}><Icon name={it.icon}/><span>{it.label}</span>{it.count!=null&&<span className="badge">{it.count}</span>}</button>; })}
            <div style={{flex:1}}/>
            <div style={{padding:"8px 12px",fontSize:10,color:"var(--t3)",lineHeight:1.5}}>All data stored in your browser. Zero server storage.</div>
          </nav>
          <main className="content"><PageComp/></main>
        </div>
      </div>
      <Toasts items={toasts}/>
      <ConfirmDialog data={confirmData}/>
    </Ctx.Provider>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
