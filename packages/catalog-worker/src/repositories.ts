/** Runs only on the authenticated mapping page. Drafts remain in memory. */
export const repositoryScript = String.raw`"use strict";
(() => {
 const el = id => document.getElementById(id);
 const options = {credentials:"same-origin", cache:"no-store", redirect:"error"};
 let current = null, original = null, fresh = null, reviewed = null;
 let busy = false, dirty = false, reconcile = false, rowSequence = 0;
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
 function clearErrors() {
   el("validation-summary").hidden = true; el("validation-errors").replaceChildren();
   for (const field of el("rows").querySelectorAll("input")) {
     field.removeAttribute("aria-invalid"); field.removeAttribute("aria-describedby");
   }
   for (const error of el("rows").querySelectorAll(".field-error")) error.remove();
 }
 function input(rowId, label, name, value, type = "text") {
   const wrapper = document.createElement("div"), caption = document.createElement("label"); caption.textContent = label;
   const field = document.createElement("input"); field.name = name; field.type = type; field.id = rowId + "-" + name;
   if (type === "checkbox") field.checked = value; else field.value = value;
   if (name === "repositoryId") {field.required=true; field.min="1";field.step="1";}
   if (name === "repository") {field.required=true;field.pattern="Zero-State-LLC/[A-Za-z0-9._\\-]+";}
   if (name === "projectId") field.pattern="project:[a-z0-9\\-]+";
   caption.htmlFor = field.id; wrapper.append(caption, field);return wrapper;
 }
 function addRow(mapping = {repositoryId:"",repository:"",enabled:false}) {
   const row=document.createElement("fieldset"); row.className="mapping-row"; row.id="mapping-"+(++rowSequence);
   const legend=document.createElement("legend");legend.textContent="Repository mapping "+rowSequence;row.append(legend);
   const fields=document.createElement("div");fields.className="mapping-fields";
   fields.append(input(row.id,"Repository ID","repositoryId",mapping.repositoryId,"number"),input(row.id,"Repository name","repository",mapping.repository),input(row.id,"Project ID","projectId",mapping.projectId ?? ""),input(row.id,"Enabled","enabled",mapping.enabled,"checkbox"));
   row.append(fields);
   const remove=document.createElement("button");remove.type="button";remove.textContent="Remove mapping";
   remove.addEventListener("click",()=>{row.remove();clearErrors();dirty=true;invalidate();el("add").focus();});
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
   clearErrors();el("rows").replaceChildren();snapshot.repositories.forEach(addRow);
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
 el("mappings").addEventListener("input",()=>{clearErrors();dirty=true;invalidate();});
 el("rebase").addEventListener("click",()=>{
   if(busy||!fresh)return;current=fresh;original=fresh;fresh=null;reconcile=false;
   el("reconciliation").hidden=true;el("revision").textContent="Observed catalog revision "+current.revision;
   invalidate();status("Draft retained against revision "+current.revision+". Review all differences before saving.");el("review").focus();
 });
 el("review").addEventListener("click",()=>{
   if(busy||!current||reconcile)return;invalidate();
   clearErrors();
   const proposed=draft(), rows=[...el("rows").querySelectorAll(".mapping-row")], errors=new Map();
   const addError=(field,message)=>{if(!errors.has(field))errors.set(field,message);};
   for(const row of rows) for(const field of row.querySelectorAll("input")) {
     if(!field.validity.valid)addError(field,field.validationMessage);
   }
   for(let i=0;i<proposed.length;i++){
     const value=proposed[i], field=name=>rows[i].querySelector('[name="'+name+'"]');
     if(!Number.isSafeInteger(value.repositoryId)||value.repositoryId<1)
       addError(field("repositoryId"),"Repository ID must be a positive safe integer.");
     if(proposed.some((other,j)=>j!==i&&other.repositoryId===value.repositoryId))
       addError(field("repositoryId"),"Repository ID duplicates another mapping. Use a unique ID.");
     if(proposed.some((other,j)=>j!==i&&other.repository.toLowerCase()===value.repository.toLowerCase()))
       addError(field("repository"),"Repository name duplicates another mapping. Use a unique name.");
   }
   if(errors.size){
     for(const [field,message] of errors){
       const error=document.createElement("span");error.id=field.id+"-error";error.className="field-error";error.textContent=message;
       field.parentElement.append(error);field.setAttribute("aria-invalid","true");field.setAttribute("aria-describedby",error.id);
       const item=document.createElement("li"),link=document.createElement("a");
       link.href="#"+field.id;link.textContent=field.closest("fieldset").querySelector("legend").textContent+", "+field.labels[0].textContent+": "+message;
       link.addEventListener("click",event=>{event.preventDefault();field.focus();});
       item.append(link);el("validation-errors").append(item);
     }
     el("mappings").reportValidity();
     el("validation-summary").hidden=false;el("validation-summary").focus();
     status("Correct the linked fields. Nothing was saved.");return;
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
