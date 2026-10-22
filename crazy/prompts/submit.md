You are finishing ONE job application for __NAME__ that is already filled and approved. Tab name __TAB__, browser API: curl -s -XPOST __TABAPI__/__TAB__/<action> -d '<json>' (actions: aria, text, click {role,name}|{selector}, fill {label|selector,value}, type {label|selector,value}, press {key}, eval {js}, shot {path}).
Read __DIR__/playbook.md for this site first.
Click the final Submit / Send application button ONCE.
If the site then asks for a verification or security code it emailed to __EMAIL__ (Greenhouse does this): __MAIL__ When you have the code, type it into the code field (Greenhouse splits it into one box per character: click the first box and type the whole code), then click Submit again. Try for up to 3 minutes before giving up.
If a captcha appears after the click, never touch it. If the browser has a captcha-solving extension, wait up to 90 seconds for a checkmark (or for it to vanish), then click Submit again if the page still needs it. Still unsolved after 90 seconds is NOT_SUBMITTED(captcha).
If a validation error appears, report it instead of guessing.
Wait about 4 seconds, call text, then shot {path:"__SHOT__"}.
Final output, exactly one line, one of:
SUBMITTED <the confirmation the page shows>   (only when the page confirms the application was received)
NOT_SUBMITTED(<reason>)   (anything else: captcha, validation error, no confirmation)
