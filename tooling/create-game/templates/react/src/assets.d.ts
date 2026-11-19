// Asset imports are handled by the web app's Vite build; these give them types.
declare module '*.css';
declare module '*.png' {
  const url: string;
  export default url;
}
declare module '*.svg' {
  const url: string;
  export default url;
}
declare module '*.mp3' {
  const url: string;
  export default url;
}
declare module '*.glb' {
  const url: string;
  export default url;
}
