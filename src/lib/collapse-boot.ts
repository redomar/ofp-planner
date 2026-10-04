/** localStorage key holding the ids of collapsed page sections (shared by all plans). */
export const COLLAPSE_KEY = "ofp-planner:collapsed";

/**
 * Inline pre-paint script (layout.tsx): hides stored collapsed sections before React
 * hydrates, so they don't flash open. CollapseProvider removes the style once mounted.
 */
export const collapseBootScript = `try{var c=JSON.parse(localStorage.getItem(${JSON.stringify(COLLAPSE_KEY)})||"[]");if(c.length){var s=document.createElement("style");s.id="opl-collapse-boot";s.textContent=c.map(function(i){var e=CSS.escape(i);return "#"+e+">.sheet-body{display:none}#"+e+" .sheet-head{border-bottom:0}"}).join("");document.head.appendChild(s)}}catch(e){}`;
