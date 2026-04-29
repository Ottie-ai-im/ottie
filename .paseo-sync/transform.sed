# paseo → ottie rename transform.
# Applied to every line of upstream files before comparing against local.
# Order matters: handle scoped npm package paths before plain "paseo".
s|@getpaseo/|@ottie/|g
s/PASEO/OTTIE/g
s/Paseo/Ottie/g
s/paseo/ottie/g
