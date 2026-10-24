"""Generate Juvia's demo try-on models (ring, bracelet, necklace) as self-contained GLB files.

Run from the project root:  python tools/make_demo_models.py
Units are metres. Each model is authored in the frame Juvia's try-on renderer expects:
  ring      X = along the finger (band axis), +Z = back of the finger (stone side)
  bracelet  X = along the forearm (band axis), loop in the YZ plane around the wrist centre
  necklace  X = wearer's side-to-side, +Y = up, +Z = out of the chest; origin = neck centre at collar height
"""
import json
import struct
from pathlib import Path

import numpy as np

OUT = Path(__file__).resolve().parent.parent / 'web' / 'assets' / 'models'

GOLD = {'name': 'Polished gold', 'pbrMetallicRoughness': {'baseColorFactor': [1.0, 0.77, 0.36, 1], 'metallicFactor': 1.0, 'roughnessFactor': 0.18}}
ROSE = {'name': 'Rose gold', 'pbrMetallicRoughness': {'baseColorFactor': [0.98, 0.66, 0.55, 1], 'metallicFactor': 1.0, 'roughnessFactor': 0.2}}
WHITE = {'name': 'White gold', 'pbrMetallicRoughness': {'baseColorFactor': [0.93, 0.93, 0.95, 1], 'metallicFactor': 1.0, 'roughnessFactor': 0.14}}
DIAMOND = {'name': 'Diamond', 'pbrMetallicRoughness': {'baseColorFactor': [0.96, 0.98, 1.0, 1], 'metallicFactor': 0.35, 'roughnessFactor': 0.02},
           'extensions': {'KHR_materials_ior': {'ior': 2.4}, 'KHR_materials_specular': {'specularFactor': 1.0}}}
EMERALD = {'name': 'Emerald', 'pbrMetallicRoughness': {'baseColorFactor': [0.05, 0.55, 0.32, 1], 'metallicFactor': 0.2, 'roughnessFactor': 0.04},
           'extensions': {'KHR_materials_ior': {'ior': 1.58}, 'KHR_materials_specular': {'specularFactor': 1.0}}}


def sweep(path, radius, segments=16, closed=True, profile_scale=None):
    """Tube along a polyline. path: (n,3). radius: scalar or (n,). Returns positions, normals, indices."""
    n = len(path)
    radius = np.broadcast_to(np.asarray(radius, float), (n,))
    tangents = np.roll(path, -1, 0) - np.roll(path, 1, 0) if closed else np.gradient(path, axis=0)
    tangents /= np.linalg.norm(tangents, axis=1, keepdims=True)
    # Parallel-transport frames (no twisting).
    ref = np.array([0, 0, 1.0]) if abs(tangents[0][2]) < 0.9 else np.array([1.0, 0, 0])
    normal = np.cross(tangents[0], ref); normal /= np.linalg.norm(normal)
    normals = [normal]
    for i in range(1, n):
        v = normals[-1] - tangents[i] * np.dot(normals[-1], tangents[i])
        normals.append(v / np.linalg.norm(v))
    normals = np.array(normals); binormals = np.cross(tangents, normals)
    if closed:
        # Distribute the transport mismatch so the seam closes cleanly.
        last = normals[-1] - tangents[0] * np.dot(normals[-1], tangents[0]); last /= np.linalg.norm(last)
        angle = np.arctan2(np.dot(np.cross(last, normals[0]), tangents[0]), np.dot(last, normals[0]))
        for i in range(n):
            a = angle * i / n; c, s = np.cos(a), np.sin(a)
            nn, bb = normals[i].copy(), binormals[i].copy()
            normals[i], binormals[i] = c * nn + s * bb, -s * nn + c * bb
    sx, sy = profile_scale or (1.0, 1.0)
    theta = np.linspace(0, 2 * np.pi, segments, endpoint=False)
    pos, nor = [], []
    for i in range(n):
        for t in theta:
            d = np.cos(t) * normals[i] * sx + np.sin(t) * binormals[i] * sy
            nd = np.cos(t) * normals[i] / sx + np.sin(t) * binormals[i] / sy
            pos.append(path[i] + d * radius[i]); nor.append(nd / np.linalg.norm(nd))
    idx = []
    rings = n if closed else n - 1
    for i in range(rings):
        j = (i + 1) % n
        for k in range(segments):
            k2 = (k + 1) % segments
            a, b, c, d = i * segments + k, i * segments + k2, j * segments + k, j * segments + k2
            idx += [a, c, b, b, c, d]
    return np.array(pos), np.array(nor), np.array(idx)


def faceted_gem(center, axis, diameter, crown=0.32, pavilion=0.43, table=0.56, facets=8):
    """Brilliant-style stone pointing its table along `axis`. Flat-shaded (duplicated vertices)."""
    axis = np.asarray(axis, float); axis /= np.linalg.norm(axis)
    u = np.cross(axis, [0, 1.0, 0] if abs(axis[1]) < 0.9 else [1.0, 0, 0]); u /= np.linalg.norm(u); v = np.cross(axis, u)
    r = diameter / 2
    ring = lambda radius, h, off=0.0: [center + axis * h + radius * (np.cos(a) * u + np.sin(a) * v) for a in np.linspace(0, 2 * np.pi, facets, endpoint=False) + off]
    girdle = ring(r, 0.0); top = ring(r * table, diameter * crown, np.pi / facets)
    table_c = center + axis * diameter * crown; culet = center - axis * diameter * pavilion
    tris = []
    for i in range(facets):
        j = (i + 1) % facets
        tris += [(table_c, top[i], top[j]), (girdle[i], girdle[j], top[i]), (girdle[j], top[j], top[i]), (girdle[j], girdle[i], culet)]
    pos, nor, idx = [], [], []
    for a, b, c in tris:
        n = np.cross(b - a, c - a); n /= np.linalg.norm(n)
        if np.dot(n, (a + b + c) / 3 - center) < 0: b, c = c, b; n = -n
        base = len(pos); pos += [a, b, c]; nor += [n, n, n]; idx += [base, base + 1, base + 2]
    return np.array(pos), np.array(nor), np.array(idx)


def merge(*parts):
    pos, nor, idx, off = [], [], [], 0
    for p, n, i in parts:
        pos.append(p); nor.append(n); idx.append(i + off); off += len(p)
    return np.concatenate(pos), np.concatenate(nor), np.concatenate(idx)


def write_glb(path, meshes, materials):
    """meshes: list of (name, (pos, nor, idx), material_index)."""
    blob = bytearray(); views, accessors, gl_meshes, nodes = [], [], [], []

    def add_view(data, target):
        while len(blob) % 4: blob.append(0)
        views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data), 'target': target}); blob.extend(data)
        return len(views) - 1

    for name, (pos, nor, idx), mat in meshes:
        pos = pos.astype(np.float32); nor = nor.astype(np.float32); idx = idx.astype(np.uint32)
        pv = add_view(pos.tobytes(), 34962); nv = add_view(nor.tobytes(), 34962); iv = add_view(idx.tobytes(), 34963)
        accessors += [{'bufferView': pv, 'componentType': 5126, 'count': len(pos), 'type': 'VEC3', 'min': pos.min(0).tolist(), 'max': pos.max(0).tolist()},
                      {'bufferView': nv, 'componentType': 5126, 'count': len(nor), 'type': 'VEC3'},
                      {'bufferView': iv, 'componentType': 5125, 'count': len(idx), 'type': 'SCALAR'}]
        a = len(accessors) - 3
        gl_meshes.append({'name': name, 'primitives': [{'attributes': {'POSITION': a, 'NORMAL': a + 1}, 'indices': a + 2, 'material': mat}]})
        nodes.append({'name': name, 'mesh': len(gl_meshes) - 1})
    while len(blob) % 4: blob.append(0)
    used = sorted({e for m in materials for e in m.get('extensions', {})})
    gltf = {'asset': {'version': '2.0', 'generator': 'Juvia demo model generator'}, 'scene': 0,
            'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'meshes': gl_meshes, 'materials': materials,
            'accessors': accessors, 'bufferViews': views, 'buffers': [{'byteLength': len(blob)}]}
    if used: gltf['extensionsUsed'] = used
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(blob), 0x004E4942) + bytes(blob)
    path.write_bytes(out)
    print(f'{path.name}: {len(out) / 1024:.0f} KB')


def ring():
    # Solitaire: 17.3 mm inner diameter (US 7), 2.2 mm comfort-fit band, 6 mm round stone in a four-prong head.
    inner, band_w, band_t = 0.00865, 0.0022, 0.0016
    t = np.linspace(0, 2 * np.pi, 160, endpoint=False)
    rad = inner + band_t / 2
    path = np.stack([np.zeros_like(t), rad * np.sin(t), rad * np.cos(t)], 1)
    band = sweep(path, 1.0, 20, True, (band_t / 2, band_w / 2))
    top = inner + band_t
    stone_c = np.array([0, 0, top + 0.0032])
    gem = faceted_gem(stone_c, [0, 0, 1], 0.006, facets=16)
    prongs = []
    for a in np.linspace(0, 2 * np.pi, 4, endpoint=False) + np.pi / 4:
        d = np.array([np.cos(a), np.sin(a), 0.0])
        p = np.array([stone_c + d * 0.0016 + [0, 0, -0.0032], stone_c + d * 0.0030 + [0, 0, -0.0008], stone_c + d * 0.0029 + [0, 0, 0.0016], stone_c + d * 0.0022 + [0, 0, 0.0024]])
        prongs.append(sweep(p, np.array([0.00045, 0.00045, 0.0004, 0.00032]), 10, False))
    basket = sweep(np.array([stone_c + [np.cos(a) * 0.0024, np.sin(a) * 0.0024, -0.0018] for a in np.linspace(0, 2 * np.pi, 48, endpoint=False)]), 0.00035, 8, True)
    write_glb(OUT / 'juvia-ring.glb', [('Band', merge(band, *prongs, basket), 0), ('Stone', gem, 1)], [GOLD, DIAMOND])


def bracelet():
    # Twisted cable bangle sized for a ~16.5 cm wrist (oval 63 × 50 mm inside), 4.5 mm thick.
    A, B, strand, twist = 0.0340, 0.0275, 0.00115, 30
    t = np.linspace(0, 2 * np.pi, 480, endpoint=False)
    base = np.stack([np.zeros_like(t), A * np.sin(t), B * np.cos(t)], 1)
    tangent = np.stack([np.zeros_like(t), A * np.cos(t), -B * np.sin(t)], 1); tangent /= np.linalg.norm(tangent, axis=1, keepdims=True)
    outward = np.cross(tangent, [1.0, 0, 0]); outward /= np.linalg.norm(outward, axis=1, keepdims=True)
    side = np.array([1.0, 0, 0])
    strands = []
    for phase in (0, np.pi):
        ang = twist * t + phase
        p = base + (np.cos(ang)[:, None] * outward + np.sin(ang)[:, None] * side) * 0.00115
        strands.append(sweep(p, strand, 12, True))
    write_glb(OUT / 'juvia-bracelet.glb', [('Bracelet', merge(*strands), 0)], [ROSE])


def necklace():
    # 45 cm-style chain resting around the neck with an emerald drop pendant at the collarbone.
    Rx, Rz, drop = 0.066, 0.058, 0.115
    t = np.linspace(0, 2 * np.pi, 720, endpoint=False)
    # 0 at the nape, 1 at the front: the chain slopes down smoothly from the back of the neck.
    hang = ((1 + np.cos(t)) / 2) ** 2.6
    x = Rx * np.sin(t) * (1 + 0.18 * hang)
    y = -drop * hang
    z = Rz * np.cos(t) + 0.028 * hang ** 1.5
    path = np.stack([x, y, z], 1)
    chain = sweep(path, 0.001, 10, True)
    low = path[np.argmin(path[:, 1])]
    bail = sweep(np.array([low + [0, -0.0006 + 0.0017 * np.cos(a), 0.0017 * np.sin(a)] for a in np.linspace(0, 2 * np.pi, 40, endpoint=False)]), 0.0005, 8, True)
    gem_c = low + [0, -0.0105, 0.0022]
    gem = faceted_gem(gem_c, [0, 0, 1], 0.011, crown=0.25, pavilion=0.35, facets=12)
    # Elongate the stone into a drop.
    gp = gem[0].copy(); rel = gp - gem_c; rel[:, 1] *= 1.35; gem = (gem_c + rel, gem[1], gem[2])
    bezel_pts = np.array([gem_c + [0.0057 * np.sin(a), 0.0057 * 1.35 * np.cos(a), -0.0004] for a in np.linspace(0, 2 * np.pi, 64, endpoint=False)])
    bezel = sweep(bezel_pts, 0.0006, 8, True)
    write_glb(OUT / 'juvia-necklace.glb', [('Chain', merge(chain, bail, bezel), 0), ('Pendant', gem, 1)], [GOLD, EMERALD])


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    ring(); bracelet(); necklace()
