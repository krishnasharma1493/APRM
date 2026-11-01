/* K-30: allocation counter and failure injector behind the fi_* names. Not part of core/. */
#include <stdlib.h>
#include <stddef.h>
long fi_countdown = -1;  /* fail when it reaches 0; -1 = never */
long fi_live = 0, fi_calls = 0;
static int fi_fail(void){ fi_calls++; if(fi_countdown>0){ fi_countdown--; if(fi_countdown==0) return 1; } return 0; }
void *fi_malloc(size_t n){ if(fi_fail()) return NULL; void *p=malloc(n); if(p) fi_live++; return p; }
void *fi_calloc(size_t a,size_t b){ if(fi_fail()) return NULL; void *p=calloc(a,b); if(p) fi_live++; return p; }
void *fi_realloc(void *o,size_t n){ if(fi_fail()) return NULL; void *p=realloc(o,n); if(p && !o) fi_live++; return p; }
void fi_free(void *p){ if(p) fi_live--; free(p); }
