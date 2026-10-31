# APRM Makefile. Compatible with GNU Make 3.81 (macOS) and later.
#
# Targets (PRD section 3):
#   make            release build of the console program: build/aprm
#   make debug      -g and -DAPRM_DEBUG (invariant checks after every step)
#   make sanitize   debug + AddressSanitizer + UBSan; also runs the C tests
#   make test       builds and runs every tests/c/test_*.c; stops at the first failure
#   make wasm       runs wasm/build.sh if it exists; until K-13 it prints a
#                   message and exits NON-ZERO (clearer than silently doing nothing)
#   make clean      removes build/ and nothing else
#
# Generic by design: later issues only add files.
#  - core: every core/*.c is compiled and linked into the CLI and into each test.
#  - tests: each tests/c/test_*.c is its own executable (it has its own main).
#  - CLI: built only if cli/main.c exists; otherwise a clear message is printed
#    and `make` still succeeds.
#  - Override the compiler with CC=clang. Set RUNNER to wrap test runs, e.g.
#    RUNNER="leaks --atExit --" on macOS.

CC      ?= cc
RUNNER  ?=

WARN    := -std=c11 -Wall -Wextra -Werror
MODE    ?= release

ifeq ($(MODE),release)
  MODEFLAGS := -O2
  BIN       := build/aprm
else ifeq ($(MODE),debug)
  MODEFLAGS := -g -O0 -DAPRM_DEBUG
  BIN       := build/aprm-debug
else ifeq ($(MODE),sanitize)
  MODEFLAGS := -g -O0 -DAPRM_DEBUG -fsanitize=address,undefined -fno-omit-frame-pointer
  BIN       := build/aprm-sanitize
else
  $(error unknown MODE '$(MODE)')
endif

CFLAGS  := $(WARN) $(MODEFLAGS) -MMD -MP -Icore
LDFLAGS := $(filter -fsanitize=%,$(MODEFLAGS))

OBJDIR    := build/$(MODE)
CORE_SRC  := $(wildcard core/*.c)
CORE_OBJ  := $(patsubst %.c,$(OBJDIR)/%.o,$(CORE_SRC))
CLI_SRC   := $(wildcard cli/*.c)
CLI_OBJ   := $(patsubst %.c,$(OBJDIR)/%.o,$(CLI_SRC))
TEST_SRC  := $(sort $(wildcard tests/c/test_*.c))
TEST_BIN  := $(patsubst tests/c/%.c,$(OBJDIR)/tests/%,$(TEST_SRC))
HAVE_CLI  := $(wildcard cli/main.c)

.PHONY: all debug sanitize test wasm clean cli-build tests-build tests-run

all:
	@$(MAKE) --no-print-directory MODE=release cli-build

debug:
	@$(MAKE) --no-print-directory MODE=debug cli-build

sanitize:
	@$(MAKE) --no-print-directory MODE=sanitize cli-build
	@$(MAKE) --no-print-directory MODE=sanitize tests-run

# Tests always run with debug checks on.
test:
	@$(MAKE) --no-print-directory MODE=debug tests-run

wasm:
	@if [ -f wasm/build.sh ]; then sh wasm/build.sh; \
	else echo "make wasm: wasm/build.sh does not exist yet (added in K-13); nothing built." >&2; exit 1; fi

clean:
	rm -rf build

# ---- internal targets (run with MODE set) ----

ifeq ($(HAVE_CLI),)
cli-build:
	@echo "note: cli/main.c does not exist yet; skipping the console program (build/aprm)."
else
cli-build: $(BIN)
endif

$(BIN): $(CORE_OBJ) $(CLI_OBJ)
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) $^ -o $@ $(LDFLAGS)

tests-build: $(TEST_BIN)

tests-run: tests-build
	@if [ -z "$(TEST_BIN)" ]; then echo "no tests/c/test_*.c found"; fi
	@for t in $(TEST_BIN); do \
	  echo "== $$t"; $(RUNNER) $$t || { echo "FAILED: $$t"; exit 1; }; \
	done
	@echo "all C tests passed ($(MODE))"

$(OBJDIR)/tests/%: tests/c/%.c $(CORE_OBJ)
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) $< $(CORE_OBJ) -o $@ $(LDFLAGS)

$(OBJDIR)/%.o: %.c
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -c $< -o $@

-include $(shell find $(OBJDIR) -name '*.d' 2>/dev/null)
