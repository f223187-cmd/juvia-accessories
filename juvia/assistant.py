from fastapi import APIRouter, Depends
import math, re
from collections import Counter
from .core import *
router=APIRouter()

# Product assistant: TF-IDF vector retrieval over the published catalogue (no external embeddings service),
# plus budget, category and occasion understanding. Works for guests; signed-in chats are logged to history.
CATEGORY_WORDS={
    'watches':{'watch','watches','timepiece','wristwatch','chronograph','dial'},
    'bracelets':{'bracelet','bracelets','bangle','bangles','cuff','cuffs','wristband'},
    'rings':{'ring','rings','solitaire','band','engagement','wedding'},
    'necklaces':{'necklace','necklaces','pendant','chain','choker','locket'},
}
SYNONYMS={'gift':'gift present','present':'gift present','wife':'gift her','girlfriend':'gift her','husband':'gift him','boyfriend':'gift him',
          'gold':'gold golden','silver':'silver steel white','rose':'rose pink','emerald':'emerald green stone','diamond':'diamond stone brilliant',
          'classic':'classic heritage timeless','minimal':'minimal slim fine','everyday':'everyday comfortable','formal':'formal classic polished'}
STOP={'the','and','for','with','that','this','are','you','have','any','show','want','need','looking','find','something','some','what','which','can','under','below','less','than','over','above','more','between','about','please','would','like','me','my','a','an','to','of','in','on','is','it','i'}
WORD=re.compile(r'[a-z0-9]+')

def tokens(text):
    out=[]
    for w in WORD.findall(text.lower()):
        if w in STOP or len(w)<2: continue
        out.extend(SYNONYMS.get(w,w).split())
        if w.endswith('es') and len(w)>4: out.append(w[:-2])
        elif w.endswith('s') and len(w)>3: out.append(w[:-1])
    return out

def budget(text):
    t=text.lower().replace(',','')
    m=re.search(r'between\s*\$?(\d+(?:\.\d+)?)\s*(?:and|-|to)\s*\$?(\d+(?:\.\d+)?)',t)
    if m: return float(m.group(1)),float(m.group(2))
    m=re.search(r'(?:under|below|less than|max(?:imum)?|up to|within|<)\s*\$?(\d+(?:\.\d+)?)',t)
    if m: return 0.0,float(m.group(1))
    m=re.search(r'(?:over|above|more than|at least|>)\s*\$?(\d+(?:\.\d+)?)',t)
    if m: return float(m.group(1)),math.inf
    m=re.search(r'\$\s*(\d+(?:\.\d+)?)',t)
    if m: v=float(m.group(1)); return 0.0,v*1.15
    return None

def wanted_categories(words):
    return {cat for cat,keys in CATEGORY_WORDS.items() if keys & set(words)}

def rank(message,rows):
    docs=[tokens(f"{p['name']} {p['name']} {p['category']} {p['category']} {p['description']}") for p in rows]
    df=Counter(w for d in docs for w in set(d)); n=len(docs)
    idf={w:math.log((1+n)/(1+c))+1 for w,c in df.items()}
    def vec(ws):
        tf=Counter(ws); v={w:(1+math.log(c))*idf.get(w,0) for w,c in tf.items()}
        norm=math.sqrt(sum(x*x for x in v.values())) or 1; return {w:x/norm for w,x in v.items()}
    q=vec(tokens(message)); scored=[]
    for p,d in zip(rows,docs):
        dv=vec(d); scored.append((sum(q[w]*dv.get(w,0) for w in q),p))
    return sorted(scored,key=lambda s:s[0],reverse=True)

SINGULAR={'watches':'watch','bracelets':'bracelet','rings':'ring','necklaces':'necklace'}
def describe(p):
    return f"{p['name']} ({SINGULAR.get(p['category'],p['category'])}, ${p['price']:.2f})"

@router.post('/api/chat')
def chat(x:ChatIn,u=Depends(optional_current)):
    words=tokens(x.message); cats=wanted_categories(WORD.findall(x.message.lower())); price=budget(x.message)
    with db() as c:
        rows=[dict(r) for r in c.execute("SELECT p.*, EXISTS(SELECT 1 FROM assets a WHERE a.product_id=p.id AND lower(a.filename) LIKE '%.glb') AS has_3d_asset FROM products p WHERE published=1 ORDER BY id DESC LIMIT 300")]
    pool=[p for p in rows if (not cats or p['category'] in cats) and (not price or price[0]<=p['price']<=price[1])]
    ranked=rank(x.message,pool) if pool else []
    gift=bool({'gift','present'} & set(words))
    hits=[p for s,p in ranked if s>0.05][:4] or ([p for _,p in ranked][:4] if (cats or price or gift) else [])
    if gift and not cats:
        # A gift request without a category: one piece from each category reads better than four of one kind.
        seen,mixed=set(),[]
        for p in hits+[p for _,p in ranked]:
            if p['category'] not in seen: seen.add(p['category']); mixed.append(p)
        hits=mixed[:4]
    if re.search(r'\b(hi|hello|hey|salam)\b',x.message.lower()) and not hits and not cats:
        answer="Hi! I'm Juvia's stylist. Tell me what you're shopping for (a watch, bracelet, ring or necklace), a budget, or who it's for, and I'll pick a few pieces you can try on live."
    elif hits:
        lead='Here are my picks'+(f" under ${price[1]:.0f}" if price and price[1]!=math.inf and price[0]==0 else '')+':'
        tail=' Each one with a 3D model can be tried on live from its card.' if any(p['has_3d_asset'] for p in hits) else ''
        answer=lead+' '+'; '.join(describe(p) for p in hits)+'.'+tail
    elif pool==[] and (cats or price):
        answer="I couldn't find a match for that"+(f" in {', '.join(sorted(cats))}" if cats else '')+(' at that budget' if price else '')+'. Try widening the budget or another category.'
    else:
        answer='I can help you find watches, bracelets, rings or necklaces. Try something like "a gold ring under $200" or "a gift for her".'
    if u: log(u,'chat',x.message)
    return {'answer':answer,'products':hits}
