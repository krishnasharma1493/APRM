/* K-30: random workloads, all policies; see tests/hardening/run.sh. */
/* Random workloads, all implemented policies: (1) no eventlog_push ever fails inside sim_step,
 * (2) debug invariants hold (abort() otherwise), (3) output is identical for any job insertion order. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include "engine.h"
#include "eventlog.h"
static uint64_t st = 0x9E3779B97F4A7C15ull;
static uint64_t rnd(void){ st ^= st<<13; st ^= st>>7; st ^= st<<17; return st; }
int eventlog_push_chk(EventLog *l, int64_t t, LogKind k, int32_t job, int64_t a0,int64_t a1,int64_t a2,int64_t a3){
  int rc = eventlog_push(l,t,k,job,a0,a1,a2,a3);
  if(rc!=APRM_OK){ fprintf(stderr,"eventlog_push FAILED (dropped log entry)\n"); abort(); }
  return rc;
}
static char *run(PolicyKind pol, int64_t alpha, int64_t T, int64_t cpu, int64_t mem, Job *jobs, int n, const int *order){
  SimConfig c; Sim *s; JsonBuf j; char *out; memset(&c,0,sizeof c);
  c.cpu_cap=cpu; c.mem_cap=mem; c.policy=pol; c.alpha_milli=alpha; c.reserve_threshold=T; c.knapsack_eps=0.1; c.max_jobs=1000;
  if(sim_create(&c,&s)) abort();
  for(int i=0;i<n;i++) if(sim_add_job(s,&jobs[order[i]])) abort();
  while(sim_step(s)==1){}
  json_init(&j); if(sim_results_json(s,&j)) abort();
  size_t a=json_len(&j);
  JsonBuf j2; json_init(&j2); sim_log_json(s,0,&j2);
  out=malloc(a+json_len(&j2)+1); memcpy(out,json_cstr(&j),a); memcpy(out+a,json_cstr(&j2),json_len(&j2)+1);
  json_free(&j); json_free(&j2); sim_destroy(s); return out;
}
int main(int argc,char**argv){
  long N=argc>1?atol(argv[1]):2000, tot=0;
  for(long it=0; it<N; it++){
    int n=1+rnd()%40; Job jobs[40]; int order[40], ord2[40];
    int64_t cpu=1+rnd()%8, mem=1+rnd()%64; int64_t maxarr = rnd()%2 ? 3 : 30;
    for(int i=0;i<n;i++){ jobs[i].id=(int32_t)(rnd()%200)+1000*i; jobs[i].arrival=rnd()%(maxarr+1); jobs[i].duration=1+rnd()%6;
      jobs[i].cpu=1+rnd()%cpu; jobs[i].mem=1+rnd()%mem; jobs[i].priority=rnd()%10; order[i]=i; ord2[i]=i; }
    for(int i=n-1;i>0;i--){ int k=rnd()%(i+1); int t=ord2[i]; ord2[i]=ord2[k]; ord2[k]=t; }
    for(int pol=0; pol<5; pol++){
      int64_t alpha=rnd()%3000, T=rnd()%10;
      char *a=run((PolicyKind)pol,alpha,T,cpu,mem,jobs,n,order), *b=run((PolicyKind)pol,alpha,T,cpu,mem,jobs,n,ord2), *c=run((PolicyKind)pol,alpha,T,cpu,mem,jobs,n,order);
      if(strcmp(a,c)){ fprintf(stderr,"NONDETERMINISTIC: same input, two runs differ (policy %d)\n",pol); return 1; }
      if(strcmp(a,b)){ fprintf(stderr,"ORDER-DEPENDENT: insertion order changed output (policy %d, iter %ld)\n",pol,it); return 1; }
      free(a);free(b);free(c); tot++;
    }
  }
  printf("stress: %ld workload/policy combos; no dropped log entry, invariants held, same-input and any-insertion-order outputs identical\n",tot);
  return 0;
}
