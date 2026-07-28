# Approval MCP Wrapper — návrh MVP

Datum: 2026-07-28  
Stav: schválený návrh

## 1. Cíl

Vytvořit single-tenant, self-hosted MCP gateway, který agreguje libovolný počet
vzdálených MCP serverů a vystavuje jejich tooly agentům podle oprávnění
konkrétního klientského tokenu.

Gateway musí před každým voláním centrálně rozhodnout, zda je volání:

- povolené,
- zakázané,
- nebo vyžaduje schválení člověkem ve webovém rozhraní.

Schválení může platit pouze pro právě čekající volání, do určeného času nebo
trvale. Časové a trvalé granty mohou být omezené podmínkou nad argumenty toolu,
například na konkrétní Signal skupinu.

MVP je určené pro soukromý AI chain jednoho provozovatele. Návrh proto
upřednostňuje jednoduché nasazení, auditovatelnost a bezpečné výchozí chování
před horizontálním škálováním.

## 2. Rozsah MVP

MVP zahrnuje:

- jeden self-hosted TypeScript/Node.js server,
- vzdálené upstream MCP servery přes Streamable HTTP,
- jednu credential sadu pro každý upstream,
- více klientských bearer tokenů,
- samostatný seznam viditelných toolů a policies pro každý klientský token,
- stabilní veřejná jména toolů ve formátu `server__tool`,
- webovou správu upstreamů, tokenů, policies, grantů, pluginů a auditu,
- webový approval inbox optimalizovaný pro mobil,
- vestavěnou identitu správce s passkey/WebAuthn,
- důvěryhodné serverové pluginy s deklarativním prezentačním výstupem,
- podrobný log každého MCP callu,
- export, retention a filtrování historie.

Mimo rozsah MVP jsou:

- multi-tenant provoz,
- lokální `stdio` MCP servery,
- více upstream credentials pro jeden server,
- vlastní JavaScriptové frontend komponenty pluginů,
- mobilní aplikace a push notifikace,
- automatický replay callů,
- automatické retry mutujících toolů,
- horizontální škálování a Node cluster mode,
- plná OAuth 2.1 authorization-server implementace pro klienty.

## 3. Protokolová kompatibilita

První implementace cílí na stabilní MCP specifikaci `2025-11-25` a používá
version negotiation. Draft změny se nepřebírají, dokud nejsou stabilní.

Gateway implementuje serverovou i klientskou stranu Streamable HTTP. Musí:

- přijímat JSON-RPC požadavky na jednom MCP endpointu,
- respektovat MCP inicializaci a capability negotiation,
- validovat `Origin` na příchozích HTTP spojeních,
- podporovat `tools/list` a `tools/call`,
- vracet tooly deterministicky seřazené,
- filtrovat `tools/list` podle autorizace prezentované v requestu,
- propagovat `notifications/tools/list_changed`, pokud se změní seznam toolů
  viditelný aktivnímu klientovi a negotiated capabilities to umožňují,
- nikdy neposílat inbound klientský token upstreamu.

MVP používá vlastní statické bearer tokeny. Je to vědomě omezená autentizační
strategie pro privátní instalaci, nikoliv plná implementace MCP OAuth 2.1 flow.
Transportní a auth vrstva musí být oddělená, aby šlo OAuth později doplnit bez
změny policy enginu.

Reference:

- [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)

## 4. Architektura

Systém je modulární monolit v jednom Node.js procesu. Moduly mají jasná
rozhraní a nesmějí si obcházet své odpovědnosti.

### 4.1 MCP Gateway

- Ověřuje klientský bearer token.
- Obsluhuje MCP lifecycle, `tools/list` a `tools/call`.
- Překládá `server__tool` na konkrétní upstream a původní jméno toolu.
- Validuje vstup proti upstream JSON Schema.
- Vytváří interní `callId`.
- Nikdy nevolá upstream bez explicitního výsledku policy enginu.

### 4.2 Upstream Registry

- Spravuje alias, URL, health a jednu credential sadu každého upstreamu.
- Načítá a cachuje seznam upstream toolů.
- Řeší reconnect a změny seznamu toolů.
- Zprostředkuje samotný call až po autorizačním rozhodnutí.

Alias upstreamu je stabilní a unikátní. Jeho změna je breaking změna veřejných
jmen toolů a UI před ní musí varovat.

### 4.3 Policy Engine

Policy engine je deterministická čistá doménová služba. Dostane:

- identitu klientského tokenu,
- upstream a tool,
- původní a normalizované argumenty,
- aktivní policies,
- aktivní granty,
- aktuální čas.

Vrátí `allow`, `deny` nebo `require_approval` včetně strojově čitelného
odůvodnění. Nepouští uživatelský kód a nemá síťový přístup.

### 4.4 Approval Orchestrator

- Vytvoří a persistuje approval request.
- Spojí čekající HTTP/MCP request s approvalem.
- Atomicky přijme nejvýše jedno rozhodnutí.
- Po schválení znovu ověří request i aktuální policy.
- Zajistí nejvýše jedno upstream vykonání pro jedno `callId`.
- Zruší možnost vykonání po disconnectu nebo timeoutu klienta.

### 4.5 Plugin Runtime

Pluginy jsou explicitně instalovaný a důvěryhodný TypeScript kód na serveru.
Plugin může:

- normalizovat argumenty do obecného policy contextu,
- označit citlivé hodnoty pro redakci,
- vytvořit srozumitelný popis requestu,
- vrátit deklarativní sekce, rizika a zvýraznění pro approval UI,
- navrhnout omezené granty, například „jen tato skupina“.

Plugin nesmí:

- rozhodnout `allow` nebo obejít policy engine,
- získat raw upstream credentials,
- sám volat upstream,
- poslat do prohlížeče vlastní spustitelný JavaScript.

Pluginové výstupy jsou validované proti verzi pluginového kontraktu. Chyba
pluginu vede k bezpečnému generic approval zobrazení nebo k odmítnutí, nikdy k
automatickému povolení.

### 4.6 Admin/Auth API a Web UI

Admin API zajišťuje passkeys, sessions, recovery, správu konfigurace, approvaly
a historii. Web UI používá stejné API a má oblasti:

- Inbox,
- History,
- Access,
- Upstreams,
- System.

Inbox se aktualizuje přes SSE. Budoucí push notifikace budou notification
adapter nad stejným approval API.

## 5. Autorizační model

### 5.1 Viditelnost

Každý klientský token má explicitní seznam dostupných upstream toolů.
Nepovolené tooly se nevracejí z `tools/list`. Samotné `tools/call` znovu
kontroluje přístup, takže skryté jméno nelze zavolat napřímo.

### 5.2 Policy podmínky

MVP podporuje pouze deklarativní operátory:

- `equals`,
- `in`,
- `startsWith`,
- `exists`.

Podmínky pracují nad verzovaným normalizovaným kontextem. Neexistuje eval,
regulární výraz dodaný uživatelem ani obecný skriptovací jazyk.

### 5.3 Precedence

Vyhodnocování probíhá v tomto pořadí:

1. explicitní `deny`,
2. kontrola viditelnosti toolu,
3. platný konkrétní grant,
4. explicitní `allow`,
5. `require_approval`,
6. implicitní `deny`.

Explicitní `deny` nelze obejít approvalem ani pluginem.

### 5.4 Granty

Jednorázový grant:

- je svázaný s `callId`,
- obsahuje hash přesného serveru, toolu a kanonizovaných argumentů,
- nelze použít pro opakované volání.

Časový a trvalý grant:

- obsahuje server, tool a explicitní podmínku,
- ukládá původ, schvalující identitu a čas,
- lze okamžitě odvolat,
- po změně verze pluginové normalizace se nesmí tiše rozšířit; nekompatibilní
  grant se deaktivuje a vyžádá kontrolu.

## 6. Tok jednoho volání

1. Klient pošle `tools/call` s bearer tokenem.
2. Gateway token ověří a vytvoří `callId`.
3. Ověří viditelnost toolu a vstupní schema.
4. Plugin připraví normalizovaný kontext, redakci a prezentaci.
5. Policy engine rozhodne:
   - `deny`: vrátit strukturovanou chybu,
   - `allow`: pokračovat na upstream,
   - `require_approval`: vytvořit approval a čekat.
6. Approval UI nabídne zamítnutí, jednorázové, časové nebo trvalé schválení.
7. Před vykonáním se atomicky ověří, že:
   - klient stále čeká,
   - approval není expirovaný,
   - request hash odpovídá,
   - policy se mezitím nezměnila na `deny`,
   - call ještě nebyl spuštěn.
8. Upstream registry provede právě jeden call.
9. Výsledek nebo chyba se rediguje, zaloguje a vrátí klientovi.

Výchozí approval timeout je pět minut a je konfigurovatelný. Pokud se klient
odpojí, volání přejde do stavu `abandoned` a pozdější schválení jej nespustí.
Restart procesu označí čekající volání jako `interrupted`.

## 7. Persistence bez native a WASM dependencies

Datová vrstva nepoužívá SQLite, PGlite ani third-party databázový runtime.

### 7.1 Config State Store

Malý konfigurační stav žije v paměti jako typované kolekce. Persistence používá
pouze stabilní Node.js API:

- změny jsou serializované jednou frontou,
- každá změna dostane monotónní sequence number,
- událost se nejprve zapíše do append-only recovery journalu,
- durable write musí být dokončen před potvrzením mutace,
- periodicky vznikne snapshot přes temporary file, `fsync` a atomický rename,
- snapshot obsahuje schema version, poslední sequence number a checksum,
- start načte poslední validní snapshot a přehraje novější journal,
- poškozený nebo nekompatibilní stav zastaví readiness místo tichého resetu.

State store obsahuje upstreamy, token metadata, tool access, policies, granty,
approvaly, passkey credentials, plugin registrations a systémová nastavení.

### 7.2 Call Journal

Historie callů je oddělená, protože může růst bez omezení:

- aktivní den se zapisuje do append-only JSONL segmentu,
- uzavřené segmenty lze komprimovat pomocí vestavěného `node:zlib`,
- každý call používá jeden `callId` a více událostí stejného lifecycle,
- vedle segmentu vznikne kompaktní index pro čas, token, upstream, tool,
  policy výsledek, approval stav a konečný status,
- index lze kompletně znovu vytvořit ze segmentu,
- neúplný poslední JSONL řádek po pádu se ignoruje a zaznamená do systémového
  auditu,
- retention je konfigurovatelná; výchozí hodnota je 90 dní,
- mazání retention jobem se týká pouze uzavřených segmentů.

Očekávaná soukromá zátěž je přibližně 500 až 2 000 callů denně. Při 2–10 KB
na call jde řádově o 0,4–7 GB za rok před kompresí. Celý call journal se nikdy
nenačítá do paměti.

History UI podporuje:

- filtrování podle času, tokenu, upstreamu, toolu, výsledku a approval stavu,
- stránkování stabilním cursorem,
- detail argumentů, rozhodnutí, latencí a výsledku,
- export JSONL a CSV,
- retention a ruční smazání starších segmentů,
- vytvoření policy nebo grantu z existujícího callu.

Fulltext, obecné analytické agregace a replay nejsou součástí MVP.

## 8. Logování a redakce

Výchozí chování ukládá redigované argumenty i redigované výsledky.

Redakce probíhá před jakýmkoliv persistentním logem:

1. odstranění transportních secrets a authorization headers,
2. centrální pravidla pro běžné názvy citlivých polí,
3. pluginová pole a cesty označené jako sensitive,
4. per-tool administrační override,
5. payload limit, truncation metadata a hash původního payloadu.

Raw credentials a klientské bearer tokeny se nesmějí objevit v call journalu,
aplikačních logách ani error objektech. Pokud redakce selže, payload se
nezaloguje a uloží se pouze metadata o chybě redakce.

## 9. Bezpečnost

- Upstream credentials jsou šifrované master klíčem dodaným mimo datový
  adresář, typicky environment secret.
- Klientské tokeny a recovery kódy se ukládají pouze jako pomalý hash vhodný
  pro daný typ secretu.
- Čitelný klientský token se zobrazí pouze jednou při vytvoření.
- Admin používá passkey/WebAuthn; HTTPS je povinné mimo localhost.
- Recovery kódy jsou jednorázové a jejich použití je auditované.
- Upstream URL prochází SSRF ochranou při konfiguraci i při každém connectu.
- Redirecty se znovu validují; DNS resolution se kontroluje proti policy.
- Přístup na loopback, link-local, metadata endpoints a privátní rozsahy je
  výchozím stavem zakázaný. Privátní rozsahy lze explicitně povolit pro
  konkrétní upstream.
- Inbound token se nikdy nepoužije jako upstream credential.
- Změny konfigurace, login, passkey operace, approvaly a granty jsou auditované.
- Admin session používá secure, HttpOnly, SameSite cookie a ochranu proti CSRF.
- Approval rozhodnutí je podmíněné revalidací aktuálního requestu a policy.

## 10. Dependency policy

Projekt preferuje Node standard library a malé množství přímých runtime
balíčků. Databázová runtime dependency je nulová.

Před přidáním každého runtime balíčku se zaznamená:

- datum posledního releasu a release cadence,
- stav repozitáře a počet aktivních maintainerů,
- týdenní npm downloads a rozumná adopce,
- přímé i transitivní runtime dependencies,
- licence,
- GitHub Advisory Database, OSV/npm audit a behavior/supply-chain scan,
- důvod, proč nelze použít Node API nebo menší balíček.

Přesné verze jsou uzamčené lockfilem. CI vytváří SBOM, provádí dependency audit
a blokuje známé high/critical runtime zranitelnosti. Aktualizace probíhají přes
samostatné PR s testy. Popularita sama o sobě nenahrazuje aktivní údržbu.

## 11. Error handling

- Neplatný token: HTTP 401 bez informace o existenci toolů.
- Neviditelný nebo neznámý tool: jednotná MCP chyba bez side-channel detailu.
- Neplatné argumenty: MCP invalid params před pluginem a upstreamem.
- Policy deny: strukturovaná bezpečná chyba s auditním reason code.
- Approval timeout/disconnect: nevykonat upstream; stav `expired`/`abandoned`.
- Plugin chyba: generic prezentace nebo fail closed podle fáze.
- Upstream timeout/chyba: žádný automatický retry mutujícího callu.
- Persistence chyba: mutace se nepotvrdí; readiness přejde do degraded/fail.
- Poškozený state snapshot: start fail closed s recovery instrukcí.
- Poškozený call segment: zachovat čitelné eventy, izolovat segment a auditovat.

## 12. Nasazení a provoz

- Jeden Docker kontejner.
- Jeden persistentní datový adresář.
- Master key a bootstrap nastavení jako secrets.
- TLS může ukončovat důvěryhodná reverse proxy.
- Proces nepodporuje více writer instancí nad stejným volume.
- Readiness ověřuje state store, master key a schopnost bezpečně persistovat.
- Upstream health ovlivňuje UI a call výsledek, nikoliv celkovou readiness.
- Backup obsahuje konzistentní config snapshot, recovery journal od snapshotu
  a uzavřené call segmenty.
- Restore se vždy ověří checksumy a dry-run replayem před zpřístupněním serveru.

## 13. Testovací strategie

### Unit testy

- precedence policies,
- všechny predikáty a hraniční hodnoty,
- expiry a revokace grantů,
- kanonizace a hash requestu,
- redakce a payload limity,
- plugin contract validation.

### Property-based a crash testy

- policy engine nikdy nepovolí explicitní deny,
- serializace/replay zachová ekvivalentní stav,
- náhodný pád v každém kroku zápisu vede ke starému nebo novému validnímu
  stavu, nikdy k částečně potvrzené mutaci,
- journal index lze vždy obnovit ze zdrojových eventů.

### Integrační testy

- simulované Streamable HTTP upstreamy,
- `tools/list` filtrování podle tokenu,
- celý allow/deny/approval flow,
- disconnect a timeout během approvalu,
- souběžná approval rozhodnutí,
- nejvýše jedno upstream volání,
- restart s čekajícími requesty,
- upstream list-changed notifikace.

### UI a bezpečnostní testy

- passkey registrace, login a recovery,
- mobilní approval inbox,
- SSRF a redirect bypassy,
- token a credential leakage,
- redakce pluginem i centrálními pravidly,
- CSRF, session fixation a approval race conditions.

## 14. Kritéria přijetí MVP

MVP je hotové, když:

1. Správce přidá alespoň dva remote MCP upstreamy a gateway vystaví jejich tooly
   se stabilním prefixem.
2. Dva různé klientské tokeny dostanou rozdílný `tools/list`.
3. Policy dokáže konkrétní call povolit, zakázat a poslat ke schválení.
4. Approval z mobilního webu pokračuje v původním čekajícím callu.
5. Jednorázový grant nelze použít podruhé.
6. Časový nebo trvalý grant lze omezit například na konkrétní `group_id`.
7. Disconnect před schválením nikdy nezpůsobí pozdější upstream side effect.
8. Souběžná rozhodnutí nikdy nevykonají upstream více než jednou.
9. Každý call lze dohledat přes history filtry a korelovat s approvalem.
10. Credentials ani bearer tokeny se neobjeví v žádném persistentním logu.
11. Config state se korektně obnoví po simulovaných pádech během zápisu.
12. Produkční runtime neobsahuje databázovou native ani WASM dependency.

## 15. Budoucí rozšíření

Návrh ponechává explicitní rozhraní pro:

- push notification adaptery,
- plnou MCP OAuth 2.1 autentizaci,
- PostgreSQL nebo jiný storage backend,
- `stdio` upstream supervisor,
- multi-tenant izolaci,
- vlastní izolovaný plugin runtime,
- fulltext a analytický storage pro call journal,
- MCP Tasks nebo jiný asynchronní approval režim.

Tato rozšíření nejsou implicitně součástí MVP a vyžadují samostatný návrh.
