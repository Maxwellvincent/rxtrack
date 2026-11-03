const sections=[['practice','Practice'],['learn','Learn'],['progress','Progress'],['sources','Sources & tools']];
export function LectureWorkspaceNav({value,onChange}){
 return <nav aria-label="Lecture workspace" className="my-4 flex flex-wrap gap-2 border-b border-border pb-3">
  {sections.map(([id,label])=><button type="button" key={id} aria-pressed={value===id} onClick={()=>onChange(id)} className={`min-h-11 rounded-lg border px-4 py-2 text-sm font-semibold ${value===id?'border-accent bg-accent-soft text-accent':'border-border text-text-2 hover:border-accent'}`}>{label}</button>)}
 </nav>;
}
