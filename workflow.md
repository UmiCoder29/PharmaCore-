# workflow.md

These rules are about HOW you work. skills.md covers WHAT is safe to build. Follow both. If they conflict, the stricter rule wins, and you tell me.

## 1. Pace
- Steady beats fast. Never skip a step to save time. A rushed change that breaks something costs more than a careful one.
- Do one thing at a time. Finish it, check it, report it, then stop.
- If a task is bigger than it looked, stop and tell me. Do not stretch it.

## 2. Before you change anything
- Read the files you will touch, and the files that call them.
- State the plan in plain words: which files, what changes, what could break.
- Ask me when something is unclear. A wrong guess is worse than a question.
- Wait for my approval before editing.

## 3. Keep changes small
- One purpose per commit. Do not mix a fix, a cleanup and a feature.
- Do not touch code outside the task, even if it looks wrong. List it at the end instead.
- Do not rename, move or delete files unless the prompt says so.
- Do not add a dependency without telling me the name, the reason, and the alternative.

## 4. Prove it works
- Run the tests, the scanner and a clean install yourself.
- A fix needs a test that fails before the fix and passes after it. Show both results.
- Test the failure path too: bad input, missing data, network error, wrong role.
- Never edit a test to make it pass. If a test is wrong, explain why and ask first.

## 5. Report honestly
- Paste raw terminal output. Never write 'all tests pass' without the output.
- Say exactly what you did NOT test or could not verify.
- If your first idea failed, say so. Do not hide dead ends.
- Never claim a file, table, function or commit exists unless you just checked it.
- If you notice your own mistake, say so at once and fix it.

## 6. Match the real project
- Use names that exist in the code and database. Search for them first.
- Check the real table and column names against the migrations, not memory.
- Your local folder may differ from GitHub. Run git fetch and git status before you start, and say which commit you are on.

## 7. Stop conditions
Stop and ask me when:
- a command fails twice or hangs more than 2 minutes;
- a change would touch the database, auth, billing, or secrets and the prompt did not say so;
- two rules conflict;
- you are about to guess.

## 8. Finish properly
End every task with this, in order:
1. Files changed, with a one-line reason each.
2. Exact commands run and their raw output.
3. How I can test it by hand, in numbered steps.
4. What you did not do or could not check.
5. Problems you saw outside this task. Do not fix them.
6. The commit hash, if I asked for a push.