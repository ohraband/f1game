from rest_framework import serializers

from .models import Competitor, Race
from .services import BRAKE, GRID_GAP, PLAYER_GRIP
from .tracks import TRACKS, get_track


class TrackSerializer(serializers.Serializer):
    key = serializers.CharField()
    name = serializers.CharField()
    country = serializers.CharField()
    length = serializers.SerializerMethodField()
    width = serializers.IntegerField()
    start = serializers.SerializerMethodField()
    path = serializers.SerializerMethodField()
    step = serializers.SerializerMethodField()    # distance between two `path` points
    safe = serializers.SerializerMethodField()    # player's safe speed at each `path` point
    brake = serializers.SerializerMethodField()   # player's braking deceleration

    def get_step(self, t):
        return round(t.spacing * 2, 2)

    def get_safe(self, t):
        return [round(limit * PLAYER_GRIP) for limit in t.limits[::2]]

    def get_brake(self, t):
        return BRAKE

    def get_length(self, t):
        return round(t.length)

    def get_start(self, t):
        x, y, a = t.point_at(0)
        return {"x": round(x, 1), "y": round(y, 1), "angle": round(a, 3)}

    def get_path(self, t):  # every 2nd point is plenty for drawing
        return [[round(x, 1), round(y, 1)] for x, y in t.points[::2]]


class CompetitorSerializer(serializers.ModelSerializer):
    grid_x = serializers.SerializerMethodField()
    grid_y = serializers.SerializerMethodField()
    grid_angle = serializers.SerializerMethodField()

    class Meta:
        model = Competitor
        fields = ["id", "name", "color", "is_player", "grid_slot", "grid_x", "grid_y", "grid_angle",
                  "pace", "finish_position", "finish_time"]
        read_only_fields = fields

    def _grid_point(self, c):
        return get_track(c.race.track).point_at(-GRID_GAP * (c.grid_slot + 1))

    def get_grid_x(self, c):
        return round(self._grid_point(c)[0], 1)

    def get_grid_y(self, c):
        return round(self._grid_point(c)[1], 1)

    def get_grid_angle(self, c):
        return round(self._grid_point(c)[2], 3)


class RaceSerializer(serializers.ModelSerializer):
    competitors = CompetitorSerializer(many=True, read_only=True)
    winner = serializers.SerializerMethodField()

    class Meta:
        model = Race
        fields = ["id", "name", "track", "laps", "status", "created_at", "winner", "competitors"]
        read_only_fields = ["status", "created_at"]
        extra_kwargs = {"laps": {"min_value": 1, "max_value": 10}}

    def validate_track(self, value):
        if value not in TRACKS:
            raise serializers.ValidationError(f"Unknown track. Choose one of: {', '.join(TRACKS)}")
        return value

    def get_winner(self, race):
        w = next((c for c in race.competitors.all() if c.finish_position == 1), None)
        return w.name if w else None


class GridClickSerializer(serializers.Serializer):
    x = serializers.FloatField()
    y = serializers.FloatField()


class PlayerSerializer(serializers.Serializer):
    competitor = serializers.IntegerField(allow_null=True)  # null = nobody drives, AI only

