'use strict';
class PriorityHeap {
 constructor(){this.items=[];this.positions=new Map();}
 before(a,b){return a.priority>b.priority||a.priority===b.priority&&(a.sequence<b.sequence||a.sequence===b.sequence&&a.id<b.id);}
 swap(a,b){[this.items[a],this.items[b]]=[this.items[b],this.items[a]];this.positions.set(this.items[a].id,a);this.positions.set(this.items[b].id,b);}
 up(i){while(i){const p=(i-1)>>1;if(!this.before(this.items[i],this.items[p]))break;this.swap(i,p);i=p;}return i;}
 down(i){for(;;){let best=i;for(const c of [i*2+1,i*2+2])if(c<this.items.length&&this.before(this.items[c],this.items[best]))best=c;if(best===i)break;this.swap(i,best);i=best;}}
 enqueue(item){if(this.positions.has(item.id))return false;this.positions.set(item.id,this.items.length);this.items.push(item);this.up(this.items.length-1);return true;}
 peek(){return this.items[0]||null;} dequeue(){const n=this.peek();if(n)this.remove(n.id);return n;}
 remove(id){const i=this.positions.get(id);if(i===undefined)return false;const last=this.items.pop();this.positions.delete(id);if(i<this.items.length){this.items[i]=last;this.positions.set(last.id,i);this.down(this.up(i));}return true;}
 update(id,priority){const i=this.positions.get(id);if(i===undefined)return false;this.items[i]={...this.items[i],priority};this.down(this.up(i));return true;}
}
class AsyncMutex {
 constructor(limit=1024,timeout=5000){if(!Number.isInteger(limit)||limit<1||limit>100000||!Number.isInteger(timeout)||timeout<1||timeout>60000)throw new Error('Mutex needs a positive bounded waiter limit and timeout');this.locked=false;this.waiters=[];this.limit=limit;this.timeout=timeout;this.contention=0;}
 acquire(){if(!this.locked){this.locked=true;return Promise.resolve(()=>this.release());}this.contention++;if(this.waiters.length>=this.limit)return Promise.reject(Object.assign(new Error('Queue command backpressure; retry later'),{status:429}));return new Promise((resolve,reject)=>{const w={resolve,reject};w.timer=setTimeout(()=>{const i=this.waiters.indexOf(w);if(i>=0)this.waiters.splice(i,1);reject(Object.assign(new Error('Queue lock timeout'),{status:503}));},this.timeout);this.waiters.push(w);});}
 release(){const w=this.waiters.shift();if(w){clearTimeout(w.timer);w.resolve(()=>this.release());}else this.locked=false;}
 async run(fn){const release=await this.acquire();try{return await fn();}finally{release();}}
}
module.exports={PriorityHeap,AsyncMutex};
