/* K-30: fail the Nth allocation for every N; see tests/hardening/run.sh. */
#include <stdlib.h>
/* Allocation-failure injection over the whole core. malloc/realloc/calloc/free are
 * renamed to fi_* at compile time (-D), so every allocation in core/ goes through fi_alloc.c. */
#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include "csv.h"
#include "engine.h"
#include "json.h"
extern long fi_countdown, fi_live, fi_calls;
static const char *CSV = "id,arrival,duration,cpu,mem,priority\n1,0,5,10,100,3\n2,0,4,10,50,9\n3,1,4,6,32768,0\n4,2,3,1,1,5\n5,2,3,16,1,5\n6,3,9,2,2,5\n7,3,2,1,1,1\n8,3,2,1,1,2\n9,3,2,1,1,3\n10,4,2,1,1,3\n11,4,7,12,3000,6\n12,5,1,1,1,3\n13,5,1,1,1,3\n14,5,1,1,1,3\n15,5,1,1,1,3\n16,5,1,1,1,3\n17,5,1,1,1,3\n18,5,1,1,1,3\n19,5,1,1,1,3\n20,5,1,1,1,3\n";
static int bad = 0, n_add_oom = 0, n_step_oom = 0;
#define CHECK(c, ...) do { if(!(c)) { bad++; printf("FAIL: " __VA_ARGS__); printf("\n"); } } while(0)

/* canonical snapshot of a Sim (state + results + log) with injection off */
static int snap(Sim *s, char **out){
  JsonBuf j; long save=fi_countdown; fi_countdown=-1; json_init(&j);
  size_t a;
  if(sim_state_json(s,&j)) {
    json_free(&j);
    fi_countdown=save;
    return -1;
  }
  a=json_len(&j);
  static char buf[1<<20]; size_t pos=0; memcpy(buf,json_cstr(&j),a); pos=a;
  json_reset(&j); sim_log_json(s,0,&j); memcpy(buf+pos,json_cstr(&j),json_len(&j)); pos+=json_len(&j); buf[pos]=0;
  json_free(&j); fi_countdown=save; *out=buf; return 0;
}
static int run_once(PolicyKind pol, long fail_at, int *oom_seen){
  SimConfig c; Sim *s=NULL; Job *jobs=NULL; int64_t n=0; CsvError e; int rc; int64_t k; static char before[1<<20];
  long live0 = fi_live;
  memset(&c,0,sizeof c); c.cpu_cap=16; c.mem_cap=32768; c.policy=pol; c.alpha_milli=100; c.reserve_threshold=0; c.knapsack_eps_milli=100; c.max_jobs=1000;
  fi_countdown = fail_at;
  rc = csv_read_jobs(CSV, strlen(CSV), 1000, &jobs, &n, &e);
  if(rc!=APRM_OK){ CHECK(rc==APRM_OUT_OF_MEMORY && jobs==NULL && n==0, "csv rc %d", rc); (*oom_seen)++; goto out; }
  rc = sim_create(&c,&s);
  if(rc!=APRM_OK){ CHECK(rc==APRM_OUT_OF_MEMORY && s==NULL, "create rc %d", rc); (*oom_seen)++; goto out; }
  for(k=0;k<n;k++){
    char *sn; 
    if(snap(s,&sn)){ bad++; break; } strcpy(before,sn);
    rc = sim_add_job(s,&jobs[k]);
    if(rc==APRM_OUT_OF_MEMORY){ n_add_oom++; (*oom_seen)++; if(snap(s,&sn)==0) CHECK(strcmp(sn,before)==0,"add_job OOM changed the state (job %lld)",(long long)jobs[k].id); 
      const SimError *er=sim_last_error(s); CHECK(er && er->code==APRM_OUT_OF_MEMORY,"add_job OOM not recorded");
      /* retry later without failure so the run can continue */
      long sv=fi_countdown; fi_countdown=-1; rc=sim_add_job(s,&jobs[k]); fi_countdown=sv; CHECK(rc==APRM_OK||rc==APRM_CAPACITY_EXCEEDED,"retry add rc %d",rc); }
    else CHECK(rc==APRM_OK||rc==APRM_CAPACITY_EXCEEDED,"add rc %d",rc);
  }
  for(;;){
    char *sn; if(snap(s,&sn)){bad++;break;} strcpy(before,sn);
    rc = sim_step(s);
    if(rc==APRM_OUT_OF_MEMORY){ n_step_oom++; (*oom_seen)++; if(snap(s,&sn)==0) CHECK(strcmp(sn,before)==0,"step OOM changed the state");
      long sv=fi_countdown; fi_countdown=-1; rc=sim_step(s); fi_countdown=sv; CHECK(rc>=0,"retry step rc %d",rc); if(rc==0)break; continue; }
    CHECK(rc>=0,"step rc %d",rc); if(rc<=0) break;
  }
  { JsonBuf j; ResultRow *rows=NULL; int64_t nr; json_init(&j);
    rc=sim_state_json(s,&j); CHECK(rc==0||rc==APRM_OUT_OF_MEMORY,"state rc %d",rc); if(rc){CHECK(json_len(&j)==0,"state fail left text");(*oom_seen)++;}
    rc=sim_results_json(s,&j); CHECK(rc==0||rc==APRM_OUT_OF_MEMORY,"results rc %d",rc); if(rc){CHECK(json_len(&j)==0,"results fail left text");(*oom_seen)++;}
    rc=sim_metrics_json(s,&j); CHECK(rc==0||rc==APRM_OUT_OF_MEMORY,"metrics rc %d",rc); if(rc){(*oom_seen)++;}
    rc=sim_log_json(s,0,&j); CHECK(rc==0||rc==APRM_OUT_OF_MEMORY,"log rc %d",rc); if(rc)(*oom_seen)++;
    json_free(&j);
    rc=sim_results_rows(s,&rows,&nr); CHECK(rc==0||rc==APRM_OUT_OF_MEMORY,"rows rc %d",rc);
    if(rc==0){ CsvText t; csv_text_init(&t); rc=csv_write_results(&t,rows,nr); CHECK(rc==0||rc==APRM_OUT_OF_MEMORY,"csv_write rc %d",rc); if(rc){CHECK(t.len==0,"csv_write rollback"); (*oom_seen)++;} csv_text_free(&t);} else {CHECK(rows==NULL&&nr==0,"rows on fail"); (*oom_seen)++;}
    free(rows);
  }
  /* reset must not allocate */
  { long sv=fi_countdown; long calls=fi_calls; fi_countdown=1; CHECK(sim_reset(s)==0,"reset"); CHECK(fi_calls==calls,"sim_reset allocated"); fi_countdown=sv; }
out:
  fi_countdown=-1;
  free(jobs); sim_destroy(s);
  CHECK(fi_live==live0,"leak: %ld live allocations after destroy (policy %d, fail_at %ld)", fi_live-live0,(int)pol,fail_at);
  return 0;
}
int main(void){
  long total_runs=0; int oom_seen=0; int pol;
  for(pol=0; pol<6; pol++){
    long calls; fi_calls=0; fi_countdown=-1; { int o=0; run_once((PolicyKind)pol,-1,&o);} calls=fi_calls;
    printf("policy %d: %ld allocation calls in a clean run\n",pol,calls);
    for(long f=1; f<=calls+2; f++){ run_once((PolicyKind)pol,f,&oom_seen); total_runs++; }
  }
  printf("add_job_oom=%d step_oom=%d\n",n_add_oom,n_step_oom); printf("runs=%ld oom_events_seen=%d failures=%d\n",total_runs,oom_seen,bad);
  return bad?1:0;
}
