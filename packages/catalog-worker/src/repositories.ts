/** Runs only on the authenticated mapping page. Drafts remain in memory. */
export const repositoryScript = String.raw`"use strict";
(() => {
 const el = id => document.getElementById(id);
 const options = {credentials:"same-origin", cache:"no-store", redirect:"error"};
 let current = null, original = null, fresh = null, reviewed = null;
 let busy = false, dirty = false, reconcile = false;
 const status = message => { el("status").textContent = message; };
 const format = value => JSON.stringify(value, null, 2);
 function controls() {
   el("fields").disabled = busy || !current || reconcile;
   el("load").disabled = busy;
   el("review").disabled = busy || !current || reconcile;
   el("save").disabled = busy || !reviewed || reconcile;
   el("rebase").disabled = busy || !fresh;
 }
 function invalidate() { reviewed = null; el("preview").hidden = true; controls(); }
 function input(label, name, value, type = "text") {
   const wrapper = document.createElement("label"); wrapper.textContent = label;
   const field = document.createElement("input"); field.name = name; field.type = type;
   if (type === "checkbox") field.checked = value; else field.value = value;
   if (name === "repositoryId") {field.required=true; field.min="1";field.step="1";}
   if (name === "repository") {field.required=true;field.pattern="Zero-State-LLC/[A-Za-z0-9._\\-]+";}
   if (name === "projectId") field.pattern="project:[a-z0-9\\-]+";
   wrapper.append(field);return wrapper;
 }
 function addRow(mapping = {repositoryId:"",repository:"",enabled:false}) {
   const row=document.createElement("fieldset"); row.className="mapping-row";
   const legend=document.createElement("legend");legend.textContent="Repository mapping";row.append(legend);
   const fields=document.createElement("div");fields.className="mapping-fields";
   fields.append(input("Repository ID","repositoryId",mapping.repositoryId,"number"),input("Repository name","repository",mapping.repository),input("Project ID","projectId",mapping.projectId ?? ""),input("Enabled","enabled",mapping.enabled,"checkbox"));
   row.append(fields);
   const remove=document.createElement("button");remove.type="button";remove.textContent="Remove mapping";
   remove.addEventListener("click",()=>{row.remove();dirty=true;invalidate();el("add").focus();});
   row.append(remove);el("rows").append(row);return row;
 }
 function draft() {
   return [...el("rows").querySelectorAll(".mapping-row")].map(row=>{
     const field=name=>row.querySelector('[name="'+name+'"]');
     const projectId=field("projectId").value.trim();
     return {repositoryId:Number(field("repositoryId").value),repository:field("repository").value.trim(),enabled:field("enabled").checked,...(projectId ? {projectId} : {})};
   });
 }
 function adopt(snapshot) {
   current=snapshot;original=snapshot;fresh=null;dirty=false;reconcile=false;
   el("rows").replaceChildren();snapshot.repositories.forEach(addRow);
   el("revision").textContent="Observed catalog revision "+snapshot.revision;
   el("reconciliation").hidden=true;invalidate();
 }
 async function readSnapshot(response) {
   if(!response.ok) throw new Error("read_failed");
   const value=await response.json();
   if(!value || value.version!==1 || !Number.isSafeInteger(value.revision) || value.revision<0 || !Array.isArray(value.repositories) || response.headers.get("ETag")!=='"'+value.revision+'"') throw new Error("invalid_response");
   return value;
 }
 async function load() {
   if(busy)return;busy=true;fresh=null;invalidate();status("Reading current catalog…");
   try {
     const snapshot=await readSnapshot(await fetch("/v1/admin/catalog/snapshot",options));
     if(dirty){
       fresh=snapshot;reconcile=true;
       el("original").textContent=format(original);
       el("readback").textContent=format(snapshot);
       el("retained").textContent=format(draft());
       el("reconciliation").hidden=false;
       status("Read revision "+snapshot.revision+". Your draft is preserved. Compare the three views before reviewing against this revision.");
     }else{adopt(snapshot);status("Loaded revision "+snapshot.revision+". Edit and review before saving.");}
   }catch{
     reconcile=true;
     status("Could not load mappings. Your draft is preserved. Sign in again and read current mappings before any mutation.");
   }finally{busy=false;controls();}
 }
 el("add").addEventListener("click",()=>{if(busy||!current||reconcile)return;const row=addRow();dirty=true;invalidate();row.querySelector("input").focus();});
 el("mappings").addEventListener("submit",event=>event.preventDefault());
 el("mappings").addEventListener("input",()=>{dirty=true;invalidate();});
 el("rebase").addEventListener("click",()=>{
   if(busy||!fresh)return;current=fresh;original=fresh;fresh=null;reconcile=false;
   el("reconciliation").hidden=true;el("revision").textContent="Observed catalog revision "+current.revision;
   invalidate();status("Draft retained against revision "+current.revision+". Review all differences before saving.");el("review").focus();
 });
 el("review").addEventListener("click",()=>{
   if(busy||!current||reconcile)return;invalidate();
   if(!el("mappings").reportValidity()){status("Correct the indicated fields. Nothing was saved.");return;}
   const proposed=draft(),ids=new Set(),names=new Set();
   for(const row of proposed){
     if(!Number.isSafeInteger(row.repositoryId)||row.repositoryId<1||ids.has(row.repositoryId)||names.has(row.repository.toLowerCase())){status("Repository IDs must be positive safe integers. Repository IDs and names must be unique. Nothing was saved.");return;}
     ids.add(row.repositoryId);names.add(row.repository.toLowerCase());
   }
   if(!Number.isSafeInteger(current.revision+1)){status("Catalog revision exhausted. Nothing was saved.");return;}
   const same=(a,b)=>a.repository===b.repository && a.projectId===b.projectId && a.enabled===b.enabled;
   const changes=[];
   for(const row of proposed){const before=current.repositories.find(r=>r.repositoryId===row.repositoryId);if(!before)changes.push(["Added",null,row]);else if(!same(before,row))changes.push(["Changed",before,row]);}
   for(const before of current.repositories)if(!proposed.some(row=>row.repositoryId===before.repositoryId))changes.push(["Removed",before,null]);
   if(!changes.length){status("No mapping changes to save. Current stored mappings match your draft.");return;}
   el("changes").replaceChildren();
   for(const [kind,before,after] of changes){const section=document.createElement("article"),heading=document.createElement("h3"),detail=document.createElement("pre");heading.textContent=kind+": "+(after??before).repository;detail.textContent="Current: "+format(before)+"\nProposed: "+format(after);section.append(heading,detail);el("changes").append(section);}
   reviewed={version:1,revision:current.revision+1,repositories:proposed};el("preview").hidden=false;controls();status("Review added, changed and removed mappings, including affected Projects, before saving.");
 });
 el("save").addEventListener("click",async()=>{
   if(busy||!current||!reviewed||reconcile)return;
   const next=reviewed,expected=current.revision;busy=true;controls();status("Saving reviewed mappings…");
   try {
     const response=await fetch("/v1/admin/catalog",{...options,method:"PUT",headers:{"Content-Type":"application/json","If-Match":'"'+expected+'"'},body:JSON.stringify(next)});
     if(response.status===409){reconcile=true;fresh=null;invalidate();status("Another operator changed the catalog. Your draft is preserved. Read current mappings for reconciliation before another mutation.");return;}
     if([400,413,415].includes(response.status)){invalidate();status("The server refused these mappings. Check IDs, names, duplicates and size. Nothing was saved.");return;}
     const saved=await readSnapshot(response);
     if(saved.revision!==next.revision || format(saved.repositories)!==format(next.repositories))throw new Error("unexpected_save");
     adopt(saved);status("Saved revision "+saved.revision+". Future collection uses these mappings.");
   }catch{reconcile=true;fresh=null;invalidate();status("Save could not be confirmed. Your draft is preserved. Read current mappings for reconciliation; do not retry the write.");}
   finally{busy=false;controls();}
 });
 el("load").addEventListener("click",load);
 window.addEventListener("beforeunload",event=>{if(dirty){event.preventDefault();event.returnValue="";}});
 void load();
})();`;
