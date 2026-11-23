from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Competitor, Race
from .serializers import (CompetitorSerializer, GridClickSerializer, PlayerSerializer, RaceSerializer,
                          TrackSerializer)
from .services import MAX_CARS, new_car_attrs, start_race
from .tracks import TRACKS, get_track


class TrackViewSet(viewsets.ViewSet):
    """GET /api/tracks/ and /api/tracks/<key>/ (read-only, premade)."""

    def list(self, request):
        return Response(TrackSerializer(TRACKS.values(), many=True).data)

    def retrieve(self, request, pk=None):
        if pk not in TRACKS:
            return Response({"detail": "Unknown track."}, status=status.HTTP_404_NOT_FOUND)
        return Response(TrackSerializer(TRACKS[pk]).data)


class RaceViewSet(mixins.CreateModelMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                  mixins.DestroyModelMixin, viewsets.GenericViewSet):
    queryset = Race.objects.prefetch_related("competitors")
    serializer_class = RaceSerializer

    def _conflict(self, msg):
        return Response({"detail": msg}, status=status.HTTP_409_CONFLICT)

    def _fresh(self, race):
        return self.get_serializer(self.get_queryset().get(pk=race.pk)).data

    @action(detail=True, methods=["post"], url_path="competitors")
    def add_competitor(self, request, pk=None):
        """Click on the track -> one more car on the grid."""
        race = self.get_object()
        if race.status != Race.Status.GRID:
            return self._conflict("Race already started.")
        click = GridClickSerializer(data=request.data)
        click.is_valid(raise_exception=True)
        track = get_track(race.track)
        if track.distance_to(click.validated_data["x"], click.validated_data["y"]) > track.width / 2 + 6:
            return Response({"detail": "Click on the track."}, status=status.HTTP_400_BAD_REQUEST)
        slot = race.competitors.count()
        if slot >= MAX_CARS:
            return Response({"detail": f"Grid is full ({MAX_CARS} cars)."}, status=status.HTTP_400_BAD_REQUEST)
        car = Competitor.objects.create(race=race, grid_slot=slot, **new_car_attrs(slot))
        return Response(CompetitorSerializer(car).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def player(self, request, pk=None):
        """Choose which competitor the human drives (`{"competitor": id}`), or null for none."""
        race = self.get_object()
        if race.status != Race.Status.GRID:
            return self._conflict("Race already started.")
        ser = PlayerSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        cid = ser.validated_data["competitor"]
        if cid is not None and not race.competitors.filter(pk=cid).exists():
            return Response({"detail": "Competitor is not in this race."}, status=status.HTTP_400_BAD_REQUEST)
        race.competitors.update(is_player=False)
        if cid is not None:
            race.competitors.filter(pk=cid).update(is_player=True)
        return Response(self._fresh(race))

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        """With a player: status becomes `running`, drive it over ws://.../ws/races/<id>/. Without: runs instantly."""
        race = self.get_object()
        if race.status != Race.Status.GRID:
            return self._conflict("Race already started.")
        if race.competitors.count() < 2:
            return Response({"detail": "Add at least 2 competitors."}, status=status.HTTP_400_BAD_REQUEST)
        start_race(race)
        return Response(self._fresh(race))

    @action(detail=True, methods=["get"])
    def replay(self, request, pk=None):
        race = self.get_object()
        if not race.replay:
            return self._conflict("Race has not been run yet.")
        return Response(race.replay)
