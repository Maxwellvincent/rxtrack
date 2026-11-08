import {Component} from 'react';
/** Last-resort display recovery for errors outside an individual study view. */
export class AppErrorBoundary extends Component{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 componentDidCatch(error,info){console.error('RXTrack app display error',error,info);}
 render(){if(!this.state.failed)return this.props.children;
  return <main role="alert" style={{maxWidth:600,margin:'3rem auto',padding:'1.5rem',background:'#f6f5f1',color:'#203033',fontFamily:'system-ui',borderRadius:12}}><h1>RXTrack couldn’t display this screen</h1><p>Reload the app to recover. This does not erase your saved study history.</p><button onClick={()=>this.props.onReload?this.props.onReload():window.location.reload()}>Reload RXTrack</button></main>;
 }
}
