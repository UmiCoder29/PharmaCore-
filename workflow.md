# workflow.md

These rules are about HOW you work. skills.md covers WHAT is safe to build and the honesty rules. Follow both. If they conflict, the stricter rule wins, and you tell me.

## 1. Pace
- Steady beats fast. Never skip a step to save time. A rushed change that breaks something costs more than a careful one.
- Do one thing at a time. Finish it, check it, report it, then stop.
- If a task is bigger than it looked, stop and tell me. Do not stretch it.

## 2. Approval words
- PLAN OK means the plan is approved and you may start the work.
- COMMIT APPROVED means you may commit and push, exactly as the prompt describes.
- PLAN OK never authorizes a commit or a push. Only COMMIT APPROVED does.
- Any other message from me, including "yes", "go ahead" or "approved", is not an approval. Ask me which one I mean.

## 3. Before you change anything
- Read the files you will touch, and the files that call them.
- State the plan in plain words: which files, what changes, what could break.
- Ask me when something is unclear. A wrong guess is worse than a question.
- Wait for PLAN OK before editing.

## 4. Keep changes small
- One purpose per commit. Do not mix a fix, a cleanup and a feature.
- Do not touch code outside the task, even if it looks wrong. List it at the end instead.
- Do not rename, move or delete files unless the prompt says so.
- New dependencies follow skills.md rule 1.8.

## 5. Prove it works
- Run the tests, the scanner and a clean install yourself.
- A fix needs a test that fails before the fix and passes after it. Show both results.
- Test the failure path too: bad input, missing data, network error, wrong role.
- Never edit a test to make it pass. If a test is wrong, explain why and ask first.
- Evidence format: show the exact command, the exit code, the summary line, and only the lines that matter. Show full output only when I ask. Never write "all tests pass" without the command and the summary line.

## 6. Report honestly
- Honesty rules are in skills.md section 3. They apply to every report.
- Say exactly what you did NOT test or could not verify.
- If your first idea failed, say so. Do not hide dead ends.
- If you notice your own mistake, say so at once and fix it.

## 7. Match the real project
- Use names that exist in the code and database. Search for them first.
- Check the real table and column names against the migrations, not memory.
- Your local folder may differ from GitHub. Run git fetch and git status before you start, and say which commit you are on.
- If git status is not clean, stop and tell me. Do not run git clean, git reset or git stash to fix it.

## 8. Keep sessions small
- My usage limit is real. Work in small chunks and do not scan the whole repo or the whole git history unless the prompt asks for it.
- Use targeted commands (git grep, git log with a path or a pattern) and trim output to what is needed.
- For a long task, keep a running scratch file OUTSIDE the repo with the results so far, so a session limit does not lose the work.
- If a task looks too big for one session, stop after the plan and tell me how you would split it.

## 9. Stop conditions
Stop and ask me when:
- a command fails twice;
- a command shows no progress for more than 2 minutes. A slow command that is making progress, like npm ci or a long scan, is fine: tell me it is slow and keep going;
- a change would touch the database, auth, billing, or secrets and the prompt did not say so;
- two rules conflict;
- you are about to guess.

## 10. Finish properly
End every task with this, in order:
1. Files changed, with a one-line reason each.
2. Commands run, each with its exit code and summary line.
3. How I can test it by hand, in numbered steps.
4. What you did not do or could not check.
5. Problems you saw outside this task. Do not fix them.
6. The commit hash, if I approved a push.